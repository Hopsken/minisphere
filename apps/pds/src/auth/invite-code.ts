import { parseDidKey, verifySig } from "@atcute/crypto";

const INVITE_CODE_VERSION = "v1";
const INVITE_CODE_BYTES = 32;
const INVITE_CODE_PURPOSE = "minisphere:create-account:v1";

const decodeBase64Url = (value: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    return null;
  }

  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(
      value.replaceAll("-", "+").replaceAll("_", "/") + padding
    );
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.codePointAt(index) ?? 0;
    }
    return bytes;
  } catch {
    return null;
  }
};

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

export const verifyInviteCode = async (
  inviteCode: string,
  pdsOrigin: string,
  controlPlanePublicKey: string
): Promise<boolean> => {
  let publicKey;
  try {
    publicKey = parseDidKey(controlPlanePublicKey);
  } catch (error) {
    throw new Error("CONTROL_PLANE_PUBLIC_KEY must be a valid did:key", {
      cause: error,
    });
  }

  const parts = inviteCode.split(".");
  if (parts.length !== 3 || parts[0] !== INVITE_CODE_VERSION) {
    return false;
  }

  const [, code, encodedSignature] = parts;
  if (!code || !encodedSignature) {
    return false;
  }

  const codeBytes = decodeBase64Url(code);
  const signature = decodeBase64Url(encodedSignature);
  if (codeBytes?.length !== INVITE_CODE_BYTES || !signature) {
    return false;
  }

  try {
    return await verifySig(
      publicKey,
      signature,
      getInviteCodeSigningInput(code, pdsOrigin)
    );
  } catch {
    return false;
  }
};
