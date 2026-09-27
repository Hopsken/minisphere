import type { Secp256k1PrivateKey } from "@atcute/crypto";
import type { AtprotoAccessTokenInput } from "@minisphere/atproto-oauth-provider";
import { z } from "zod";

import { signJwt } from "./jwt";

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

export const createOAuthAccessToken = (
  input: AtprotoAccessTokenInput,
  signingKey: Secp256k1PrivateKey,
  now = Math.floor(Date.now() / 1000)
) => {
  const value = accessTokenInputSchema.parse(input);
  return signJwt(signingKey, "at+jwt", {
    aud: value.audience,
    client_id: value.clientId,
    cnf: { jkt: value.jwkThumbprint },
    exp: now + value.expiresIn,
    iat: now,
    iss: value.issuer,
    jti: crypto.randomUUID(),
    scope: value.scope,
    sub: value.subject,
  });
};
