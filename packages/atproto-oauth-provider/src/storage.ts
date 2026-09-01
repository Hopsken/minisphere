import type { AuthContext } from "better-auth";

type InternalAdapter = AuthContext["internalAdapter"];

const PREFIX = "atproto-oauth";
const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export const randomToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
};

const digest = async (value: string) =>
  toBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))
  );

const identifier = async (kind: string, token: string) =>
  `${PREFIX}:${kind}:${await digest(token)}`;

const parse = <T>(value: string): T | null => {
  try {
    // SAFETY: This package is the only writer for its namespaced records, and
    // each caller supplies the matching record type for the selected kind.
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

export const reserveRecord = async <T>(
  adapter: InternalAdapter,
  kind: string,
  token: string,
  value: T,
  expiresAt: Date
) => {
  const key = await identifier(kind, token);
  const existing = await adapter.findVerificationValue(key);
  if (existing) {
    return false;
  }
  return adapter.reserveVerificationValue({
    expiresAt,
    identifier: key,
    value: JSON.stringify(value),
  });
};

export const createUniqueRecord = async <T>(
  adapter: InternalAdapter,
  kind: string,
  value: T,
  expiresAt: Date
) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomToken();
    // Reservations must be sequential so that each collision gets a new token.
    // oxlint-disable-next-line no-await-in-loop
    if (await reserveRecord(adapter, kind, token, value, expiresAt)) {
      return token;
    }
  }
  throw new Error(`Unable to reserve a unique ${kind} record`);
};

export const findRecord = async <T>(
  adapter: InternalAdapter,
  kind: string,
  token: string
): Promise<T | null> => {
  const key = await identifier(kind, token);
  const record = await adapter.findVerificationValue(key);
  if (!record || record.expiresAt < new Date()) {
    return null;
  }
  return parse<T>(record.value);
};

export const consumeRecord = async <T>(
  adapter: InternalAdapter,
  kind: string,
  token: string
): Promise<T | null> => {
  const record = await adapter.consumeVerificationValue(
    await identifier(kind, token)
  );
  return record ? parse<T>(record.value) : null;
};

export const deleteRecord = async (
  adapter: InternalAdapter,
  kind: string,
  token: string
) => adapter.deleteVerificationByIdentifier(await identifier(kind, token));
