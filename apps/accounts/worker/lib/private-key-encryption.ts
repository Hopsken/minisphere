const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

const importEncryptionKey = async (secret: string) => {
  if (secret.length < 32) {
    throw new Error(
      "ACCOUNTS_KEY_ENCRYPTION_KEY must contain at least 32 high-entropy characters"
    );
  }
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
};

const encode = (bytes: Uint8Array) => btoa(String.fromCodePoint(...bytes));
const decode = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);
const additionalData = (purpose: string, id: string) =>
  encoder.encode(JSON.stringify([purpose, id]));

export const encryptPrivateKey = async (
  privateKey: string,
  purpose: string,
  id: string,
  secret: string
) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { additionalData: additionalData(purpose, id), iv, name: "AES-GCM" },
    await importEncryptionKey(secret),
    encoder.encode(privateKey)
  );
  return {
    encryptedPrivateKey: encode(new Uint8Array(ciphertext)),
    encryptionIv: encode(iv),
  };
};

export const decryptPrivateKey = async (
  encrypted: { encryptedPrivateKey: string; encryptionIv: string },
  purpose: string,
  id: string,
  secret: string
) => {
  const iv = decode(encrypted.encryptionIv);
  if (iv.length !== 12) {
    throw new Error("Invalid private-key encryption IV");
  }
  return decoder.decode(
    await crypto.subtle.decrypt(
      { additionalData: additionalData(purpose, id), iv, name: "AES-GCM" },
      await importEncryptionKey(secret),
      decode(encrypted.encryptedPrivateKey)
    )
  );
};
