import {
  parseDidKey,
  parsePrivateMultikey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import { deriveDidFromGenesisOp, signOperation } from "@atcute/did-plc";
import type { DidKeyString, UnsignedOperation } from "@atcute/did-plc";
import { isHandle } from "@atcute/lexicons/syntax";
import { Hono } from "hono";
import z from "zod";

import { zValidator } from "../../utils/z-validator";

const app = new Hono<{
  Bindings: Env;
}>();

const rotationKeySchema = z
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
    { error: "Invalid rotation key" }
  )
  .transform(
    (value): DidKeyString => `did:key:${value.slice("did:key:".length)}`
  );

const registerSchema = z.object({
  name: z
    .string()
    .min(2, { error: "User name must be at least 2 characters" })
    .max(63, { error: "User name must be at most 63 characters" })
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u, {
      error: "User name must be a lowercase domain label",
    }),
  rotationKeys: z
    .array(rotationKeySchema)
    .min(1, { error: "At least one rotation key is required" })
    .max(4, { error: "At most four rotation keys are allowed" })
    .refine((keys) => new Set(keys).size === keys.length, {
      error: "Rotation keys must be unique",
    }),
});

app.post("/register", zValidator("json", registerSchema), async (c) => {
  const { name, rotationKeys: requestedRotationKeys } = c.req.valid("json");
  const pdsHostname = c.env.PDS_HOSTNAME.toLowerCase();
  const pdsOrigin = `https://${pdsHostname}`;
  const handle = `${name}.${pdsHostname}`;

  if (!isHandle(handle)) {
    throw new Error("PDS hostname does not produce a valid handle");
  }

  const parsedRotationKey = parsePrivateMultikey(c.env.PDS_ROTATION_KEY);
  if (parsedRotationKey.type !== "secp256k1") {
    throw new Error("PDS_ROTATION_KEY must be a secp256k1 private multikey");
  }

  const rotationKey = await Secp256k1PrivateKey.importRaw(
    parsedRotationKey.privateKeyBytes
  );
  const pdsRotationKey = await rotationKey.exportPublicKey("did");
  const rotationKeys = [
    ...requestedRotationKeys.filter((key) => key !== pdsRotationKey),
    pdsRotationKey,
  ];

  const repoKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const repoSigningKey = await repoKey.exportPublicKey("did");
  const unsignedOperation: UnsignedOperation = {
    alsoKnownAs: [`at://${handle}`],
    prev: null,
    rotationKeys,
    services: {
      atproto_pds: {
        endpoint: pdsOrigin,
        type: "AtprotoPersonalDataServer",
      },
    },
    type: "plc_operation",
    verificationMethods: { atproto: repoSigningKey },
  };
  const operation = await signOperation(unsignedOperation, rotationKey);
  const did = await deriveDidFromGenesisOp(operation);

  const repoSigningKeyMultikey = await repoKey.exportPrivateKey("multikey");
  const pds = c.env.PDS.getByName(did);
  await pds.reserveRepo(did, repoSigningKeyMultikey);

  return c.json({ did, operation });
});

export default app;
