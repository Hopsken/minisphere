import { parsePrivateMultikey, Secp256k1PrivateKey } from "@atcute/crypto";

import { encodeBase64Url } from "./base64";

const INVITE_CODE_PURPOSE = "minisphere:create-account:v1";
const INVITE_CODE_VERSION = "v1";
const INVITE_CODE_BYTES = 32;

export const getInviteCodeSigningInput = (
  code: string,
  pdsOrigin: string
): Uint8Array<ArrayBuffer> => {
  const encoded = new TextEncoder().encode(
    `${INVITE_CODE_PURPOSE}\0${pdsOrigin.toLowerCase()}\0${code}`
  );
  const bytes = new Uint8Array(encoded.length);
  bytes.set(encoded);
  return bytes;
};

export const createInviteCode = async (
  privateMultikey: string,
  pdsOrigin: string
): Promise<string> => {
  const parsedKey = parsePrivateMultikey(privateMultikey);
  if (parsedKey.type !== "secp256k1") {
    throw new Error("CONTROL_PLANE_INVITE_KEY must be a secp256k1 private key");
  }

  const key = await Secp256k1PrivateKey.importRaw(parsedKey.privateKeyBytes);
  const code = encodeBase64Url(
    crypto.getRandomValues(new Uint8Array(INVITE_CODE_BYTES))
  );
  const signature = await key.sign(getInviteCodeSigningInput(code, pdsOrigin));
  return `${INVITE_CODE_VERSION}.${code}.${encodeBase64Url(signature)}`;
};
