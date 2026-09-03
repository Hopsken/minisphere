import * as CreateAccount from "@atcute/atproto/types/server/createAccount";
import * as CreateSession from "@atcute/atproto/types/server/createSession";
import * as ReserveSigningKey from "@atcute/atproto/types/server/reserveSigningKey";
import { parseDidKey } from "@atcute/crypto";
import { PlcClient } from "@atcute/did-plc";
import type { DidKeyString, DidPlcString, Operation } from "@atcute/did-plc";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import z from "zod";

import { createSessionTokens } from "../../auth/session";
import { createPdsDatabase } from "../../db";
import {
  accountsTable,
  refreshTokensTable,
  signingKeyReservationsTable,
} from "../../db/schema";
import { InviteCodeRepository } from "../../repositories/invite-code";
import { SigningKeyReservationRepository } from "../../repositories/signing-key-reservation";
import { lexiconJsonValidator } from "../../utils/lexicon-validator";

const app = new Hono<{ Bindings: Env }>();

const didKeySchema = z
  .string()
  .refine(
    (value) => {
      try {
        parseDidKey(value);
        return true;
      } catch {
        return false;
      }
    },
    { error: "Invalid did:key" }
  )
  .transform(
    (value): DidKeyString => `did:key:${value.slice("did:key:".length)}`
  );

const entrywayAccountSchema = z.object({
  did: z
    .string()
    .regex(/^did:plc:[a-z2-7]{24}$/u, "Invalid did:plc identifier")
    .transform(
      (value): DidPlcString => `did:plc:${value.slice("did:plc:".length)}`
    ),
  inviteCode: z.string().min(1),
  plcOp: z.looseObject({
    alsoKnownAs: z.array(z.string()),
    prev: z.null(),
    rotationKeys: z.array(didKeySchema),
    services: z.record(
      z.string(),
      z.looseObject({ endpoint: z.string(), type: z.string() })
    ),
    sig: z.string().min(1),
    type: z.literal("plc_operation"),
    verificationMethods: z
      .object({ atproto: didKeySchema })
      .catchall(didKeySchema),
  }),
});

const directoryClient = (env: Env) =>
  new PlcClient({
    fetch: (request, init) => env.DIRECTORY.fetch(new Request(request, init)),
    serviceUrl: "https://minisphere-directory.service",
  });

const signingKeyReservations = (env: Env) =>
  new SigningKeyReservationRepository(
    createPdsDatabase(env.PDS_DB),
    env.PDS_SIGNING_KEY_ENCRYPTION_KEY
  );

const ensureDirectoryOperation = async (
  env: Env,
  did: DidPlcString,
  operation: Operation
) => {
  const directory = directoryClient(env);
  try {
    await directory.submitOperation(did, operation);
  } catch (submitError) {
    try {
      const log = await directory.getOperationLog(did);
      if (log.some((entry) => entry.sig === operation.sig)) {
        return;
      }
    } catch {
      // The submit result remains unknown. Preserve the original error.
    }
    throw submitError;
  }
};

app.post(
  "/com.atproto.server.reserveSigningKey",
  lexiconJsonValidator(ReserveSigningKey.mainSchema.input.schema),
  async (c) => {
    const { did } = c.req.valid("json");
    return c.json({
      signingKey: await signingKeyReservations(c.env).reserve(did),
    });
  }
);

app.post(
  "/com.atproto.server.createAccount",
  lexiconJsonValidator(CreateAccount.mainSchema.input.schema),
  async (c) => {
    const input = c.req.valid("json");
    const entrywayAccount = entrywayAccountSchema.safeParse(input);
    if (!entrywayAccount.success) {
      throw new HTTPException(400, { cause: entrywayAccount.error });
    }
    const { did, inviteCode, plcOp } = entrywayAccount.data;
    const { handle } = input;
    const pdsDb = createPdsDatabase(c.env.PDS_DB);
    if (!(await new InviteCodeRepository(pdsDb).claim(inviteCode))) {
      throw new HTTPException(400, { message: "Invalid invite code" });
    }

    const signingKey = plcOp.verificationMethods.atproto;
    const repoSigningKey = await signingKeyReservations(c.env).claim(
      did,
      signingKey
    );
    if (!repoSigningKey) {
      throw new HTTPException(400, {
        message: "Reserved repository signing key is no longer available",
      });
    }

    const pdsHostname = new URL(c.env.PDS_ORIGIN).hostname;
    const session = await createSessionTokens(
      did,
      `did:web:${pdsHostname}`,
      c.env.PDS_JWT_SECRET
    );

    const repo = c.env.REPO.getByName(did);
    await repo.reserveRepo(did, repoSigningKey);
    await ensureDirectoryOperation(c.env, did, plcOp);

    const accountWrites = [
      pdsDb.insert(accountsTable).values({ did }).onConflictDoNothing(),
      pdsDb.insert(refreshTokensTable).values({
        did,
        expires_at: session.refreshToken.expiresAt,
        jti: session.refreshToken.jti,
      }),
    ] as const;
    await pdsDb.batch([
      ...accountWrites,
      pdsDb
        .delete(signingKeyReservationsTable)
        .where(
          and(
            eq(signingKeyReservationsTable.did, did),
            eq(signingKeyReservationsTable.signingKey, signingKey)
          )
        ),
    ]);

    return c.json({
      accessJwt: session.accessJwt,
      did,
      handle,
      refreshJwt: session.refreshJwt,
    });
  }
);

app.post(
  "/com.atproto.server.createSession",
  lexiconJsonValidator(CreateSession.mainSchema.input.schema),
  () => {
    // Expected response: CreateSession.$output
    throw new Error("Not implemented");
  }
);

app.get("/com.atproto.server.getSession", () => {
  // Expected response: GetSession.$output
  throw new Error("Not implemented");
});

app.get("/com.atproto.server.describeServer", () => {
  // Expected response: DescribeServer.$output
  throw new Error("Not implemented");
});

export default app;
