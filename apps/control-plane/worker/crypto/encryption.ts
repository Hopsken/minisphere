import { decodeBase64Url, encodeBase64Url } from "./base64";

const ENCRYPTION_VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

const importEncryptionKey = (encodedKey: string): Promise<CryptoKey> => {
  const keyBytes = decodeBase64Url(encodedKey);
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

export const encryptText = async (
  value: string,
  encodedKey: string,
  context: string
): Promise<string> => {
  const key = await importEncryptionKey(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: new TextEncoder().encode(context),
      iv,
      name: "AES-GCM",
    },
    key,
    new TextEncoder().encode(value)
  );
  return `${ENCRYPTION_VERSION}.${encodeBase64Url(iv)}.${encodeBase64Url(
    new Uint8Array(ciphertext)
  )}`;
};

export const decryptText = async (
  value: string,
  encodedKey: string,
  context: string
): Promise<string> => {
  const [version, encodedIv, encodedCiphertext, ...rest] = value.split(".");
  if (
    version !== ENCRYPTION_VERSION ||
    !encodedIv ||
    !encodedCiphertext ||
    rest.length > 0
  ) {
    throw new Error("Invalid encrypted value");
  }

  const iv = decodeBase64Url(encodedIv);
  if (iv.length !== IV_BYTES) {
    throw new Error("Invalid encrypted value");
  }

  const key = await importEncryptionKey(encodedKey);
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: new TextEncoder().encode(context),
      iv,
      name: "AES-GCM",
    },
    key,
    decodeBase64Url(encodedCiphertext)
  );
  return new TextDecoder().decode(plaintext);
};
