// oxlint-disable-next-line unicorn/no-abusive-eslint-disable
// oxlint-disable
// From: https://github.com/ascorbic/cirrus/blob/0aec63160b12bd6a7340eeeee3144f249fed9f23/packages/pds/src/account-do.ts#L1779
import { asCid } from "@atproto/lex-data";

/**
 * Serialize a record for JSON by converting CID objects to { $link: "..." } format.
 * CBOR-decoded records contain raw CID objects that need conversion for JSON serialization.
 */
export const serializeRecord = (obj: unknown): Rpc.Serializable<unknown> => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Check if this is a CID object using @atproto/lex-data helper
  const cid = asCid(obj);
  if (cid) {
    // oxlint-disable-next-line anti-slop/no-known-value-widening
    return { $link: cid.toString() };
  }

  // Convert Uint8Array to { $bytes: "<base64>" }
  if (obj instanceof Uint8Array) {
    let binary = "";

    for (let i = 0; i < obj.length; i += 1) {
      binary += String.fromCharCode(obj[i]!);
    }
    return { $bytes: btoa(binary) };
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeRecord);
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeRecord(value);
    }
    return result;
  }

  return obj;
};
