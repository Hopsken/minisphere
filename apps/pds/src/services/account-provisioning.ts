import {
  parseDidKey,
  parsePrivateMultikey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import {
  deriveDidFromGenesisOp,
  PlcClient,
  signOperation,
} from "@atcute/did-plc";
import type {
  DidKeyString,
  Operation,
  UnsignedOperation,
} from "@atcute/did-plc";
import { isHandle } from "@atcute/lexicons/syntax";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createPdsDatabase } from "../db";
import { accountCreationOperationsTable, accountsTable } from "../db/schema";

const recoveryKeySchema = z
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

const handleSchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .refine(isHandle, { error: "Invalid handle" })
  .refine(
    (value) => {
      const labelLength = value.split(".", 1)[0]?.length ?? 0;
      return labelLength >= 2 && labelLength <= 63;
    },
    { error: "Account name must contain 2-63 characters" }
  );

export const accountProvisioningInputSchema = z.strictObject({
  handle: handleSchema,
  operationId: z.uuid(),
  recoveryKey: recoveryKeySchema,
});

export type AccountProvisioningInput = z.input<
  typeof accountProvisioningInputSchema
>;

export type AccountProvisioningResult =
  | { did: string; handle: string; status: "active" }
  | { reason: "handle_unavailable"; status: "failed" };

const deriveRepoKey = async (
  rotationKeyBytes: Uint8Array,
  operationId: string
) => {
  const sourceKeyBytes = new Uint8Array(rotationKeyBytes.byteLength);
  sourceKeyBytes.set(rotationKeyBytes);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    sourceKeyBytes.buffer,
    "HKDF",
    false,
    ["deriveBits"]
  );
  for (let counter = 0; counter < 256; counter += 1) {
    const privateKeyBytes = new Uint8Array(
      // oxlint-disable-next-line eslint/no-await-in-loop -- Candidate keys must be tested in deterministic counter order.
      await crypto.subtle.deriveBits(
        {
          hash: "SHA-256",
          info: new TextEncoder().encode(
            `minisphere-pds-repo-key\0${operationId}\0${counter}`
          ),
          name: "HKDF",
          salt: new Uint8Array(32),
        },
        keyMaterial,
        256
      )
    );
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Stop at the first valid deterministic scalar.
      return await Secp256k1PrivateKeyExportable.importRaw(privateKeyBytes);
    } catch {
      // The derived integer can very rarely fall outside the secp256k1 range.
    }
  }
  throw new Error("Could not derive a valid repository signing key");
};

const createAccountMaterial = async (
  env: Env,
  operationId: string,
  handle: string,
  recoveryKey: DidKeyString
) => {
  const parsedRotationKey = parsePrivateMultikey(env.PDS_ROTATION_KEY);
  if (parsedRotationKey.type !== "secp256k1") {
    throw new Error("PDS_ROTATION_KEY must be a secp256k1 private multikey");
  }

  const [rotationKey, repoKey] = await Promise.all([
    Secp256k1PrivateKey.importRaw(parsedRotationKey.privateKeyBytes),
    deriveRepoKey(parsedRotationKey.privateKeyBytes, operationId),
  ]);
  const [pdsRotationKey, repoSigningKey] = await Promise.all([
    rotationKey.exportPublicKey("did"),
    repoKey.exportPublicKey("did"),
  ]);
  const rotationKeys = [pdsRotationKey];
  if (recoveryKey !== pdsRotationKey) {
    rotationKeys.unshift(recoveryKey);
  }

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
  const plcOperation = await signOperation(unsignedOperation, rotationKey);
  return {
    did: await deriveDidFromGenesisOp(plcOperation),
    plcOperation,
    repoSigningKey: await repoKey.exportPrivateKey("multikey"),
  };
};

const ensureDirectoryOperation = async (
  env: Env,
  did: `did:plc:${string}`,
  operation: Operation
) => {
  const directory = new PlcClient({
    fetch: (request, init) => env.DIRECTORY.fetch(new Request(request, init)),
    serviceUrl: "https://minisphere-directory.service",
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

export class AccountProvisioningService {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  async createAccount(
    untrustedInput: AccountProvisioningInput
  ): Promise<AccountProvisioningResult> {
    const input = accountProvisioningInputSchema.parse(untrustedInput);
    const material = await createAccountMaterial(
      this.env,
      input.operationId,
      input.handle,
      input.recoveryKey
    );
    const database = createPdsDatabase(this.env.PDS_DB);

    await database
      .insert(accountCreationOperationsTable)
      .values({
        did: material.did,
        handle: input.handle,
        operationId: input.operationId,
        status: "provisioning",
      })
      .onConflictDoNothing();
    const operation =
      await database.query.accountCreationOperationsTable.findFirst({
        where: { operationId: input.operationId },
      });
    if (!operation || operation.handle !== input.handle) {
      return { reason: "handle_unavailable", status: "failed" };
    }
    if (operation.status === "active") {
      return { did: operation.did, handle: operation.handle, status: "active" };
    }
    if (operation.did !== material.did) {
      throw new Error(
        "Account creation cannot resume because its derived DID changed"
      );
    }

    const repo = this.env.REPO.getByName(material.did);
    await repo.reserveRepo(material.did, material.repoSigningKey);
    await ensureDirectoryOperation(
      this.env,
      material.did,
      material.plcOperation
    );

    await database.batch([
      database
        .insert(accountsTable)
        .values({ did: material.did })
        .onConflictDoNothing(),
      database
        .update(accountCreationOperationsTable)
        .set({ status: "active" })
        .where(
          and(
            eq(accountCreationOperationsTable.operationId, input.operationId),
            eq(accountCreationOperationsTable.status, "provisioning")
          )
        ),
    ]);

    return { did: material.did, handle: input.handle, status: "active" };
  }
}
