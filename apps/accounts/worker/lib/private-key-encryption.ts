const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

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

interface KeyEncryptionContext {
  purpose: string;
  keyId: string;
}

const encodeBase64 = (bytes: Uint8Array) =>
  btoa(String.fromCodePoint(...bytes));
const decodeBase64 = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);
const encodeAdditionalData = ({ purpose, keyId }: KeyEncryptionContext) =>
  encoder.encode(JSON.stringify([purpose, keyId]));

export const encryptPrivateKey = async (
  privateKey: string,
  context: KeyEncryptionContext,
  secret: string
) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { additionalData: encodeAdditionalData(context), iv, name: "AES-GCM" },
    await importEncryptionKey(secret),
    encoder.encode(privateKey)
  );
  return {
    encryptedPrivateKey: encodeBase64(new Uint8Array(ciphertext)),
    encryptionIv: encodeBase64(iv),
  };
};

export const decryptPrivateKey = async (
  encrypted: { encryptedPrivateKey: string; encryptionIv: string },
  context: KeyEncryptionContext,
  secret: string
) => {
  const iv = decodeBase64(encrypted.encryptionIv);
  if (iv.length !== 12) {
    throw new Error("Invalid private-key encryption IV");
  }
  return decoder.decode(
    await crypto.subtle.decrypt(
      { additionalData: encodeAdditionalData(context), iv, name: "AES-GCM" },
      await importEncryptionKey(secret),
      decodeBase64(encrypted.encryptedPrivateKey)
    )
  );
};
