import * as CreateAccount from "@atcute/atproto/types/server/createAccount";
import * as CreateSession from "@atcute/atproto/types/server/createSession";
import * as ReserveSigningKey from "@atcute/atproto/types/server/reserveSigningKey";
import {
  parseDidKey,
  parsePrivateMultikey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import {
  deriveDidFromGenesisOp,
  isSignedOperationValid,
  PlcClient,
  signOperation,
  validateIncomingOp,
} from "@atcute/did-plc";
import type {
  DidKeyString,
  DidPlcString,
  Operation,
  UnsignedOperation,
} from "@atcute/did-plc";
import { isHandle } from "@atcute/lexicons/syntax";
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
    { error: "Invalid DID PLC recovery key" }
  )
  .transform(
    (value): DidKeyString => `did:key:${value.slice("did:key:".length)}`
  );

const didPlcSchema = z
  .string()
  .regex(/^did:plc:[a-z2-7]{24}$/u, "Invalid did:plc identifier")
  .transform(
    (value): DidPlcString => `did:plc:${value.slice("did:plc:".length)}`
  );

const handleSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .refine(isHandle, { error: "Invalid handle" })
  .refine(
    (value) => {
      const accountNameLength = value.split(".", 1)[0]?.length ?? 0;
      return accountNameLength >= 2 && accountNameLength <= 63;
    },
    { error: "Account name must contain 2-63 characters" }
  );

const createAccountSchema = z.strictObject({
  did: didPlcSchema.optional(),
  handle: handleSchema,
  inviteCode: z.string().min(1).optional(),
  plcOp: z
    .strictObject({
      alsoKnownAs: z.array(z.string()),
      prev: z.null(),
      rotationKeys: z.array(didKeySchema),
      services: z.record(
        z.string(),
        z.strictObject({ endpoint: z.string(), type: z.string() })
      ),
      sig: z.string().min(1),
      type: z.literal("plc_operation"),
      verificationMethods: z.record(z.string(), didKeySchema),
    })
    .optional(),
  recoveryKey: didKeySchema.optional(),
});

interface AccountMaterial {
  did: DidPlcString;
  operation: Operation;
  repoSigningKey: string;
  reservedSigningKey?: DidKeyString;
}

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

const createLocalAccountMaterial = async (
  env: Env,
  handle: string,
  recoveryKey?: DidKeyString
): Promise<AccountMaterial> => {
  const parsedRotationKey = parsePrivateMultikey(env.PDS_ROTATION_KEY);
  if (parsedRotationKey.type !== "secp256k1") {
    throw new Error("PDS_ROTATION_KEY must be a secp256k1 private multikey");
  }

  const rotationKey = await Secp256k1PrivateKey.importRaw(
    parsedRotationKey.privateKeyBytes
  );
  const pdsRotationKey = await rotationKey.exportPublicKey("did");
  const rotationKeys = [pdsRotationKey];
  if (recoveryKey && recoveryKey !== pdsRotationKey) {
    rotationKeys.unshift(recoveryKey);
  }

  const repoKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const repoSigningKey = await repoKey.exportPublicKey("did");
  const unsignedOperation: UnsignedOperation = {
    alsoKnownAs: [`at://${handle}`],
    prev: null,
    rotationKeys,
    services: {
      atproto_pds: {
        endpoint: new URL(env.PDS_ORIGIN).origin,
        type: "AtprotoPersonalDataServer",
      },
    },
    type: "plc_operation",
    verificationMethods: { atproto: repoSigningKey },
  };
  const operation = await signOperation(unsignedOperation, rotationKey);
  return {
    did: await deriveDidFromGenesisOp(operation),
    operation,
    repoSigningKey: await repoKey.exportPrivateKey("multikey"),
  };
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
  const repoSigningKey = await reservations.get(did, signingKey);
  if (!repoSigningKey) {
    throw new HTTPException(400, {
      message: "Reserved repository signing key does not exist",
    });
  }
  return { did, operation, repoSigningKey, reservedSigningKey: signingKey };
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
  zValidator("json", createAccountSchema),
  async (c) => {
    const { did, handle, inviteCode, plcOp, recoveryKey } = c.req.valid("json");

    if (!inviteCode) {
      throw new HTTPException(400, { message: "Invite code is required" });
    }

    const pdsUrl = new URL(c.env.PDS_ORIGIN);
    const pdsHostname = pdsUrl.hostname;
    const isEntrywayAccount = did !== undefined || plcOp !== undefined;
    let material: AccountMaterial;
    if (isEntrywayAccount) {
      if (!did || !plcOp) {
        throw new HTTPException(400, {
          message: "Entryway account creation requires DID and PLC operation",
        });
      }
      material = await validateEntrywayAccountMaterial(
        c.env,
        did,
        handle,
        plcOp
      );
    } else {
      material = await createLocalAccountMaterial(c.env, handle, recoveryKey);
    }

    const pdsDb = createPdsDatabase(c.env.PDS_DB);
    if (!(await new InviteCodeRepository(pdsDb).claim(inviteCode))) {
      throw new HTTPException(400, { message: "Invalid invite code" });
    }

    if (material.reservedSigningKey) {
      const claimedKey = await signingKeyReservations(c.env).claim(
        material.did,
        material.reservedSigningKey
      );
      if (!claimedKey) {
        throw new HTTPException(400, {
          message: "Reserved repository signing key is no longer available",
        });
      }
      material.repoSigningKey = claimedKey;
    }

    const session = await createSessionTokens(
      material.did,
      `did:web:${pdsHostname}`,
      c.env.PDS_JWT_SECRET
    );

    const repo = c.env.REPO.getByName(material.did);
    await repo.reserveRepo(material.did, material.repoSigningKey);
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
    await (material.reservedSigningKey
      ? pdsDb.batch([
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
        ])
      : pdsDb.batch(accountWrites));

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
