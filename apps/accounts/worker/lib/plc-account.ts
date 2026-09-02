import {
  parseDidKey,
  parsePrivateMultikey,
  Secp256k1PrivateKey,
} from "@atcute/crypto";
import { deriveDidFromGenesisOp, signOperation } from "@atcute/did-plc";
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

export const createPlcAccountMaterial = async (
  rotationKeyMultikey: string,
  handle: string,
  pdsOrigin: string,
  signingKeyInput: string
): Promise<PlcAccountMaterial> => {
  const parsedRotationKey = parsePrivateMultikey(rotationKeyMultikey);
  if (parsedRotationKey.type !== "secp256k1") {
    throw new Error(
      "ACCOUNTS_PLC_ROTATION_KEY must be a secp256k1 private multikey"
    );
  }

  const rotationKey = await Secp256k1PrivateKey.importRaw(
    parsedRotationKey.privateKeyBytes
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
    operation,
    signingKey,
  };
};
