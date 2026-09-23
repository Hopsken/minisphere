import {
  parseDidKey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import {
  deriveDidFromGenesisOp,
  isSignedOperationValid,
  signOperation,
} from "@atcute/did-plc";
import type {
  DidKeyString,
  Operation,
  UnsignedOperation,
} from "@atcute/did-plc";

const normalizeDidKey = (value: string): DidKeyString => {
  parseDidKey(value);
  return `did:key:${value.slice("did:key:".length)}`;
};

export interface PlcAccountMaterial {
  did: `did:plc:${string}`;
  operation: Operation;
  signingKey: DidKeyString;
}

const encoder = new TextEncoder();
const rotationKeyAad = (userId: string) =>
  encoder.encode(JSON.stringify(["accounts:plc-rotation-key:v1", userId]));
const encodeBase64 = (bytes: Uint8Array) =>
  btoa(String.fromCodePoint(...bytes));
const decodeBase64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);

const importEncryptionKey = async (secret: string) => {
  if (secret.length < 32) {
    throw new Error(
      "ACCOUNTS_ENCRYPTION_KEY must contain at least 32 high-entropy characters"
    );
  }
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
};

export const decryptPlcRotationKey = async (
  userId: string,
  encryptionSecret: string,
  stored: {
    encryptedRotationKey: string | null;
    rotationKeyIv: string | null;
  }
) => {
  if (!stored.encryptedRotationKey || !stored.rotationKeyIv) {
    throw new Error("Missing PLC rotation key");
  }
  const bytes = await crypto.subtle.decrypt(
    {
      additionalData: rotationKeyAad(userId),
      iv: decodeBase64(stored.rotationKeyIv),
      name: "AES-GCM",
    },
    await importEncryptionKey(encryptionSecret),
    decodeBase64(stored.encryptedRotationKey)
  );
  return Secp256k1PrivateKey.importRaw(new Uint8Array(bytes));
};

export const createPlcAccountMaterial = async (
  userId: string,
  encryptionSecret: string,
  handle: string,
  pdsOrigin: string,
  signingKeyInput: string
) => {
  const rotationKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { additionalData: rotationKeyAad(userId), iv, name: "AES-GCM" },
    await importEncryptionKey(encryptionSecret),
    await rotationKey.exportPrivateKey("raw")
  );
  const [rotationKeyDid, signingKey] = await Promise.all([
    rotationKey.exportPublicKey("did"),
    Promise.resolve(normalizeDidKey(signingKeyInput)),
  ]);
  const unsignedOperation: UnsignedOperation = {
    alsoKnownAs: [`at://${handle}`],
    prev: null,
    rotationKeys: [rotationKeyDid],
    services: {
      atproto_pds: {
        endpoint: new URL(pdsOrigin).origin,
        type: "AtprotoPersonalDataServer",
      },
    },
    type: "plc_operation",
    verificationMethods: { atproto: signingKey },
  };
  const operation = await signOperation(unsignedOperation, rotationKey);
  return {
    did: await deriveDidFromGenesisOp(operation),
    encryptedRotationKey: encodeBase64(new Uint8Array(encrypted)),
    operation,
    rotationKeyIv: encodeBase64(iv),
    signingKey,
  };
};

export const restorePlcAccountMaterial = async (
  userId: string,
  encryptionSecret: string,
  stored: {
    did: string | null;
    signingKey: string | null;
    operation: Operation | null;
    encryptedRotationKey: string | null;
    rotationKeyIv: string | null;
  }
): Promise<PlcAccountMaterial> => {
  if (
    !stored.did ||
    !stored.signingKey ||
    !stored.operation ||
    !stored.encryptedRotationKey ||
    !stored.rotationKeyIv
  ) {
    throw new Error(
      "Provisioning account is missing its PLC identity material"
    );
  }
  const key = await decryptPlcRotationKey(userId, encryptionSecret, stored);
  const publicKey = await key.exportPublicKey("did");
  const did = await deriveDidFromGenesisOp(stored.operation);
  if (
    did !== stored.did ||
    stored.operation.prev !== null ||
    stored.operation.rotationKeys.length !== 1 ||
    stored.operation.rotationKeys[0] !== publicKey ||
    stored.operation.verificationMethods.atproto !== stored.signingKey ||
    !(await isSignedOperationValid([publicKey], stored.operation))
  ) {
    throw new Error(
      "Stored PLC identity material does not match its genesis operation"
    );
  }
  return {
    did,
    operation: stored.operation,
    signingKey: normalizeDidKey(stored.signingKey),
  };
};
