import { isDid } from "@atcute/lexicons/syntax";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

const ACCESS_TOKEN_LIFETIME_SECONDS = 2 * 60 * 60;
const REFRESH_TOKEN_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
const OAUTH_ACCESS_TOKEN_MAX_LIFETIME_SECONDS = 5 * 60;
const SESSION_SECRET_MIN_BYTES = 32;

const textEncoder = new TextEncoder();

export interface SessionTokens {
  accessJwt: string;
  refreshJwt: string;
  refreshToken: {
    expiresAt: number;
    jti: string;
  };
}

const oauthAccessTokenInputSchema = z
  .object({
    audience: z.url(),
    clientId: z.url(),
    expiresIn: z
      .number()
      .int()
      .min(1)
      .max(OAUTH_ACCESS_TOKEN_MAX_LIFETIME_SECONDS),
    issuer: z.url(),
    jwkThumbprint: z.string().regex(/^[A-Za-z\d_-]{43}$/u),
    scope: z.string().refine((scope) => scope.split(" ").includes("atproto"), {
      message: "scope must contain atproto",
    }),
    subject: z.string().refine((value): boolean => isDid(value), {
      message: "subject must be a DID",
    }),
  })
  .strict();

const oauthAccessTokenClaimsSchema = z
  .object({
    aud: z.string(),
    client_id: z.string(),
    cnf: z.object({ jkt: z.string() }).strict(),
    exp: z.number().int(),
    iat: z.number().int(),
    iss: z.string(),
    jti: z.string(),
    scope: z.string(),
    sub: z.string().refine((value): boolean => isDid(value), {
      message: "sub must be a DID",
    }),
  })
  .strict();

export type OAuthAccessTokenInput = z.infer<typeof oauthAccessTokenInputSchema>;
export type OAuthAccessTokenClaims = z.infer<
  typeof oauthAccessTokenClaimsSchema
>;

const getSecretBytes = (secret: string) => {
  const secretBytes = textEncoder.encode(secret);
  if (secretBytes.length < SESSION_SECRET_MIN_BYTES) {
    throw new Error("PDS_JWT_SECRET must contain at least 32 bytes");
  }
  return secretBytes;
};

export const createOAuthAccessToken = (
  input: OAuthAccessTokenInput,
  secret: string,
  now = Math.floor(Date.now() / 1000)
) => {
  const value = oauthAccessTokenInputSchema.parse(input);
  return new SignJWT({
    client_id: value.clientId,
    cnf: { jkt: value.jwkThumbprint },
    scope: value.scope,
  })
    .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
    .setIssuer(value.issuer)
    .setAudience(value.audience)
    .setSubject(value.subject)
    .setJti(crypto.randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + value.expiresIn)
    .sign(getSecretBytes(secret));
};

export const verifyOAuthAccessToken = async (
  token: string,
  issuer: string,
  audience: string,
  secret: string
): Promise<OAuthAccessTokenClaims> => {
  const verified = await jwtVerify(token, getSecretBytes(secret), {
    algorithms: ["HS256"],
    audience,
    issuer,
    typ: "at+jwt",
  });
  return oauthAccessTokenClaimsSchema.parse(verified.payload);
};

export const createSessionTokens = async (
  did: string,
  audience: string,
  secret: string,
  now = Math.floor(Date.now() / 1000)
): Promise<SessionTokens> => {
  const secretBytes = getSecretBytes(secret);

  const refreshJti = crypto.randomUUID();
  const refreshExpiresAt = now + REFRESH_TOKEN_LIFETIME_SECONDS;

  const [accessJwt, refreshJwt] = await Promise.all([
    new SignJWT({ scope: "com.atproto.access" })
      .setProtectedHeader({ alg: "HS256", typ: "at+jwt" })
      .setAudience(audience)
      .setSubject(did)
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TOKEN_LIFETIME_SECONDS)
      .sign(secretBytes),
    new SignJWT({ scope: "com.atproto.refresh" })
      .setProtectedHeader({ alg: "HS256", typ: "refresh+jwt" })
      .setAudience(audience)
      .setSubject(did)
      .setJti(refreshJti)
      .setIssuedAt(now)
      .setExpirationTime(refreshExpiresAt)
      .sign(secretBytes),
  ]);

  return {
    accessJwt,
    refreshJwt,
    refreshToken: { expiresAt: refreshExpiresAt, jti: refreshJti },
  };
};
