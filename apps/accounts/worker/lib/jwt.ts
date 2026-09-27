import { verifySigWithDidKey } from "@atcute/crypto";
import type { Secp256k1PrivateKey } from "@atcute/crypto";
import { z } from "zod";
import type { ZodType } from "zod";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const headerSchema = z.strictObject({
  alg: z.literal("ES256K"),
  kid: z.string().startsWith("did:key:"),
  typ: z.string(),
});

export const encodeBase64Url = (value: Uint8Array) => {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const decodeBase64Url = (value: string) => {
  if (!/^[A-Za-z\d_-]+$/u.test(value)) {
    throw new Error("JWT contains invalid base64url");
  }
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.codePointAt(0) ?? 0);
};

const decodeJson = <T>(schema: ZodType<T>, value: string) =>
  schema.parse(JSON.parse(decoder.decode(decodeBase64Url(value))));

type JwtClaims = Record<string, string | number | Record<string, string>>;

/** Signs a compact ES256K JWT whose `kid` is the signing key's `did:key`. */
export const signJwt = async (
  signingKey: Secp256k1PrivateKey,
  typ: string,
  claims: JwtClaims
) => {
  const header = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        alg: "ES256K",
        kid: await signingKey.exportPublicKey("did"),
        typ,
      })
    )
  );
  const payload = encodeBase64Url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const signature = await signingKey.sign(encoder.encode(signingInput));
  return `${signingInput}.${encodeBase64Url(signature)}`;
};

/**
 * Verifies a compact ES256K JWT of the given `typ` and parses its claims.
 * `isTrustedKid` decides which signing keys are accepted.
 */
export const verifyJwt = async <T>(
  token: string,
  typ: string,
  claimsSchema: ZodType<T>,
  isTrustedKid: (kid: string) => Promise<boolean>
) => {
  const [header, payload, signature, ...rest] = token.split(".");
  if (!header || !payload || !signature || rest.length > 0) {
    throw new Error("JWT must be compact");
  }
  const { kid, typ: actualTyp } = decodeJson(headerSchema, header);
  if (actualTyp !== typ || !(await isTrustedKid(kid))) {
    throw new Error("JWT type or key is not accepted");
  }
  const valid = await verifySigWithDidKey(
    kid,
    decodeBase64Url(signature),
    encoder.encode(`${header}.${payload}`)
  );
  if (!valid) {
    throw new Error("JWT signature is invalid");
  }
  return decodeJson(claimsSchema, payload);
};
