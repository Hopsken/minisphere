const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BITS = 256;
const PASSWORD_HASH_ITERATIONS = 100_000;
const textEncoder = new TextEncoder();

const derivePasswordHash = async (
  password: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<Uint8Array> => {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    {
      hash: "SHA-256",
      iterations: PASSWORD_HASH_ITERATIONS,
      name: "PBKDF2",
      salt,
    },
    passwordKey,
    PASSWORD_HASH_BITS
  );
  return new Uint8Array(hash);
};

const encodeHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePasswordHash(password, salt);
  return `pbkdf2-sha256$${PASSWORD_HASH_ITERATIONS}$${encodeHex(salt)}$${encodeHex(hash)}`;
};
