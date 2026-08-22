import { fromBase64Url } from "@atcute/multibase";
import { CompactEncrypt, compactDecrypt } from "jose";

const KEY_BYTES = 32;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const importKey = (encodedKey: string): Promise<CryptoKey> => {
  const keyBytes = fromBase64Url(encodedKey);
  if (keyBytes.length !== KEY_BYTES) {
    throw new Error(
      "CONTROL_PLANE_ENCRYPTION_KEY must be a 32-byte base64url value"
    );
  }
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
};

export const encryptCrendential = async (
  credential: string,
  key: string,
  signature: string
) => {
  const cryptoKey = await importKey(key);
  const encryptor = new CompactEncrypt(encoder.encode(credential));
  encryptor.setProtectedHeader({
    alg: "dir",
    enc: "A256GCM",
    signature,
  });

  return encryptor.encrypt(cryptoKey);
};

export const decryptCredential = async (
  encrypted: string,
  key: string,
  signature: string
): Promise<string> => {
  const cryptoKey = await importKey(key);
  const result = await compactDecrypt(encrypted, cryptoKey, {
    contentEncryptionAlgorithms: ["A256GCM"],
    keyManagementAlgorithms: ["dir"],
  });

  if (result.protectedHeader["signature"] !== signature) {
    throw new Error("Credential signature mismatch!");
  }

  return decoder.decode(result.plaintext);
};
