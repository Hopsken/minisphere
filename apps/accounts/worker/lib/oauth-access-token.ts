import type { Secp256k1PrivateKey } from "@atcute/crypto";
import type { AtprotoAccessTokenInput } from "@minisphere/atproto-oauth-provider";
import { z } from "zod";

const accessTokenInputSchema = z.strictObject({
  audience: z.url(),
  clientId: z.url(),
  expiresIn: z
    .number()
    .int()
    .min(1)
    .max(5 * 60),
  issuer: z.url(),
  jwkThumbprint: z.string().regex(/^[A-Za-z\d_-]{43}$/u),
  scope: z.string().refine((scope) => scope.split(" ").includes("atproto"), {
    message: "scope must contain atproto",
  }),
  subject: z.string().startsWith("did:"),
});

const encoder = new TextEncoder();

const encodeBase64Url = (value: Uint8Array) => {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export const createOAuthAccessToken = async (
  input: AtprotoAccessTokenInput,
  signingKey: Secp256k1PrivateKey,
  now = Math.floor(Date.now() / 1000)
) => {
  const value = accessTokenInputSchema.parse(input);
  const protectedHeader = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        alg: "ES256K",
        kid: await signingKey.exportPublicKey("did"),
        typ: "at+jwt",
      })
    )
  );
  const payload = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: value.audience,
        client_id: value.clientId,
        cnf: { jkt: value.jwkThumbprint },
        exp: now + value.expiresIn,
        iat: now,
        iss: value.issuer,
        jti: crypto.randomUUID(),
        scope: value.scope,
        sub: value.subject,
      })
    )
  );
  const signingInput = `${protectedHeader}.${payload}`;
  const signature = await signingKey.sign(encoder.encode(signingInput));
  return `${signingInput}.${encodeBase64Url(signature)}`;
};
