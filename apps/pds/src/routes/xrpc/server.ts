import * as CreateAccount from "@atcute/atproto/types/server/createAccount";
import type * as DescribeServer from "@atcute/atproto/types/server/describeServer";
import * as GetServiceAuth from "@atcute/atproto/types/server/getServiceAuth";
import * as ReserveSigningKey from "@atcute/atproto/types/server/reserveSigningKey";
import { parseDidKey } from "@atcute/crypto";
import { PlcClient } from "@atcute/did-plc";
import type { DidKeyString, DidPlcString, Operation } from "@atcute/did-plc";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import z from "zod";

import { createSessionTokens } from "../../auth/session";
import { forwardSessionRequest } from "../../clients/accounts";
import { resolveConfig } from "../../config";
import { createPdsDatabase } from "../../db";
import {
  accountsTable,
  refreshTokensTable,
  signingKeyReservationsTable,
} from "../../db/schema";
import { withResourceAuth } from "../../middlewares/with-resource-auth";
import { withServiceProxy } from "../../middlewares/with-service-proxy";
import { InviteCodeRepository } from "../../repositories/invite-code";
import { SigningKeyReservationRepository } from "../../repositories/signing-key-reservation";
import {
  lexiconJsonValidator,
  lexiconQueryValidator,
} from "../../utils/lexicon-validator";
import { xrpcError } from "../../utils/xrpc-error";
import { zValidator } from "../../utils/z-validator";

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
  handle: z.string(),
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

const signingKeyReservations = (env: Env) =>
  new SigningKeyReservationRepository(
    createPdsDatabase(env.PDS_DB),
    env.PDS_ENCRYPTION_KEY
  );

const ensureDirectoryOperation = async (
  did: DidPlcString,
  operation: Operation
) => {
  const config = resolveConfig();
  const directory = new PlcClient({
    serviceUrl: config.plcDirectory,
  });
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
  zValidator("json", entrywayAccountSchema),
  async (c) => {
    const { did, handle, inviteCode, plcOp } = c.req.valid("json");
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

    const pdsHostname = new URL(resolveConfig().pdsOrigin).hostname;
    const session = await createSessionTokens(
      did,
      `did:web:${pdsHostname}`,
      c.env.PDS_JWT_SECRET
    );

    const repo = c.env.REPO.getByName(did);
    await repo.reserveRepo(did, repoSigningKey);
    await ensureDirectoryOperation(did, plcOp);

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
    // Relays learn about the account only after its identity and record exist.
    await repo.rpcAnnounceAccount(handle);

    return c.json({
      accessJwt: session.accessJwt,
      did,
      handle,
      refreshJwt: session.refreshJwt,
    });
  }
);

app
  .post("/com.atproto.server.createSession", (c) =>
    forwardSessionRequest(c.req.raw, "com.atproto.server.createSession")
  )
  .post("/com.atproto.server.refreshSession", (c) =>
    forwardSessionRequest(c.req.raw, "com.atproto.server.refreshSession")
  )
  .get("/com.atproto.server.getSession", (c) =>
    forwardSessionRequest(c.req.raw, "com.atproto.server.getSession")
  )
  .post("/com.atproto.server.deleteSession", (c) =>
    forwardSessionRequest(c.req.raw, "com.atproto.server.deleteSession")
  );

app.get(
  "/com.atproto.server.getServiceAuth",
  lexiconQueryValidator(GetServiceAuth.mainSchema.params),
  withResourceAuth,
  withServiceProxy,
  async (c) => {
    const { aud, exp, lxm } = c.req.valid("query");
    // A token without `lxm` would be valid for every method of `aud`,
    // including account management that the proxy refuses.
    if (!lxm) {
      throw xrpcError("InvalidRequest", "lxm is required");
    }
    if (exp !== undefined) {
      const remaining = exp - Math.floor(Date.now() / 1000);
      if (remaining < 0) {
        throw xrpcError("BadExpiration", "expiration is in past");
      }
      if (remaining > 60 * 60) {
        throw xrpcError(
          "BadExpiration",
          "cannot request a token with an expiration more than an hour in the future"
        );
      }
    }
    c.var.serviceProxy.authorize(aud, lxm);
    return c.json<GetServiceAuth.$output>({
      token: await c.var.serviceProxy.createServiceJwt(aud, lxm, exp),
    });
  }
);

app.get("/com.atproto.server.describeServer", (c) => {
  const pdsHostname = new URL(resolveConfig().pdsOrigin).hostname;
  // Accounts is the Entryway: it creates accounts and owns hosted handle
  // domains, so this PDS offers no domains for direct sign-up.
  return c.json<DescribeServer.$output>({
    availableUserDomains: [],
    did: `did:web:${pdsHostname}`,
    inviteCodeRequired: true,
  });
});

export default app;
