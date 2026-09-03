import * as CreateAccount from "@atcute/atproto/types/server/createAccount";
import * as CreateSession from "@atcute/atproto/types/server/createSession";
import * as ReserveSigningKey from "@atcute/atproto/types/server/reserveSigningKey";
import {
  defs,
  deriveDidFromGenesisOp,
  isSignedOperationValid,
  PlcClient,
  validateIncomingOp,
} from "@atcute/did-plc";
import type { DidKeyString, DidPlcString, Operation } from "@atcute/did-plc";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import * as v from "valibot";

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

interface AccountMaterial {
  did: DidPlcString;
  operation: Operation;
  reservedSigningKey: DidKeyString;
}

const validateCreateAccountInput = (input: CreateAccount.$input) => {
  const { did, handle, inviteCode, plcOp } = input;
  if (!inviteCode) {
    throw new HTTPException(400, { message: "Invite code is required" });
  }
  if (
    (
      [
        "email",
        "password",
        "recoveryKey",
        "verificationCode",
        "verificationPhone",
      ] as const
    ).some((field) => input[field] !== undefined)
  ) {
    throw new HTTPException(400, {
      message: "Unsupported account creation fields",
    });
  }

  const didResult = v.safeParse(defs.didPlcString, did);
  const operationResult = v.safeParse(defs.operation, plcOp);
  if (!didResult.success || !operationResult.success) {
    throw new HTTPException(400, {
      message: "Account creation requires a DID PLC genesis operation",
    });
  }
  if (operationResult.output.prev !== null) {
    throw new HTTPException(400, { message: "Invalid PLC operation" });
  }

  return {
    did: didResult.output,
    handle: handle.toLowerCase(),
    inviteCode,
    plcOp: operationResult.output,
  };
};

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

const validateEntrywayAccountMaterial = async (
  env: Env,
  did: DidPlcString,
  handle: string,
  operation: Operation
): Promise<AccountMaterial> => {
  try {
    validateIncomingOp(operation);
  } catch (error) {
    throw new HTTPException(400, {
      cause: error,
      message: "Invalid PLC operation",
    });
  }

  const expectedDid = await deriveDidFromGenesisOp(operation);
  if (
    expectedDid !== did ||
    (await isSignedOperationValid(operation.rotationKeys, operation)) === null
  ) {
    throw new HTTPException(400, {
      message: "DID and PLC operation do not match",
    });
  }

  const signingKey = operation.verificationMethods.atproto;
  const pdsService = operation.services.atproto_pds;
  if (!signingKey) {
    throw new HTTPException(400, {
      message: "PLC operation is missing the repository signing key",
    });
  }
  if (
    operation.alsoKnownAs.length !== 1 ||
    operation.alsoKnownAs[0] !== `at://${handle}`
  ) {
    throw new HTTPException(400, {
      message: "PLC operation handle does not match the requested account",
    });
  }
  if (
    pdsService?.type !== "AtprotoPersonalDataServer" ||
    pdsService.endpoint !== new URL(env.PDS_ORIGIN).origin
  ) {
    throw new HTTPException(400, {
      message: "PLC operation does not target this PDS",
    });
  }

  const reservations = signingKeyReservations(env);
  if (!(await reservations.get(did, signingKey))) {
    throw new HTTPException(400, {
      message: "Reserved repository signing key does not exist",
    });
  }
  return { did, operation, reservedSigningKey: signingKey };
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
    const { did, handle, inviteCode, plcOp } = validateCreateAccountInput(
      c.req.valid("json")
    );
    const material = await validateEntrywayAccountMaterial(
      c.env,
      did,
      handle,
      plcOp
    );

    const pdsDb = createPdsDatabase(c.env.PDS_DB);
    if (!(await new InviteCodeRepository(pdsDb).claim(inviteCode))) {
      throw new HTTPException(400, { message: "Invalid invite code" });
    }

    const repoSigningKey = await signingKeyReservations(c.env).claim(
      material.did,
      material.reservedSigningKey
    );
    if (!repoSigningKey) {
      throw new HTTPException(400, {
        message: "Reserved repository signing key is no longer available",
      });
    }

    const pdsHostname = new URL(c.env.PDS_ORIGIN).hostname;
    const session = await createSessionTokens(
      material.did,
      `did:web:${pdsHostname}`,
      c.env.PDS_JWT_SECRET
    );

    const repo = c.env.REPO.getByName(material.did);
    await repo.reserveRepo(material.did, repoSigningKey);
    await ensureDirectoryOperation(c.env, material.did, material.operation);

    const accountWrites = [
      pdsDb
        .insert(accountsTable)
        .values({ did: material.did })
        .onConflictDoNothing(),
      pdsDb.insert(refreshTokensTable).values({
        did: material.did,
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
            eq(signingKeyReservationsTable.did, material.did),
            eq(
              signingKeyReservationsTable.signingKey,
              material.reservedSigningKey
            )
          )
        ),
    ]);

    return c.json({
      accessJwt: session.accessJwt,
      did: material.did,
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
