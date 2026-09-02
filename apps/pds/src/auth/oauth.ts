import { Secp256k1PublicKey } from "@atcute/crypto";
import { isDid } from "@atcute/lexicons/syntax";
import { z } from "zod";

const OAUTH_ACCESS_TOKEN_MAX_LIFETIME_SECONDS = 5 * 60;

const protectedHeaderSchema = z.strictObject({
  alg: z.literal("ES256K"),
  kid: z.string().min(1),
  typ: z.literal("at+jwt"),
});

const authorizationServerMetadataSchema = z.looseObject({
  issuer: z.url(),
  jwks_uri: z.url(),
});

const oauthVerificationJwkSchema = z
  .looseObject({
    alg: z.literal("ES256K"),
    crv: z.literal("secp256k1"),
    d: z.never().optional(),
    key_ops: z.array(z.string()).optional(),
    kid: z.string().min(1),
    kty: z.literal("EC"),
    use: z.literal("sig").optional(),
    x: z.string(),
    y: z.string(),
  })
  .refine((jwk) => !jwk.key_ops || jwk.key_ops.includes("verify"), {
    message: "OAuth verification JWK cannot verify signatures",
  });

const jwksSchema = z.looseObject({
  keys: z.array(z.looseObject({ kid: z.string().optional() })),
});

const oauthAccessTokenClaimsSchema = z.strictObject({
  aud: z.string(),
  client_id: z.string(),
  cnf: z.strictObject({ jkt: z.string() }),
  exp: z.number().int(),
  iat: z.number().int(),
  iss: z.string(),
  jti: z.string(),
  scope: z.string(),
  sub: z.string().refine((value): boolean => isDid(value), {
    message: "sub must be a DID",
  }),
});

export type OAuthAccessTokenClaims = z.infer<
  typeof oauthAccessTokenClaimsSchema
>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const decodeBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z\d_-]+$/u.test(value)) {
    throw new Error("OAuth access token contains invalid base64url");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes;
};

const fetchJson = async (url: string, fetcher: typeof fetch) => {
  const response = await fetcher(url, {
    headers: { Accept: "application/json" },
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`OAuth metadata request failed with ${response.status}`);
  }
  return response.json();
};

const resolveOAuthVerificationKey = async (
  issuer: string,
  kid: string,
  fetcher: typeof fetch
) => {
  const issuerUrl = new URL(issuer);
  if (issuerUrl.origin !== issuer) {
    throw new Error("OAuth issuer must be an origin");
  }
  const metadata = authorizationServerMetadataSchema.parse(
    await fetchJson(`${issuer}/.well-known/oauth-authorization-server`, fetcher)
  );
  if (metadata.issuer !== issuer) {
    throw new Error("OAuth authorization-server issuer does not match");
  }
  const jwksUrl = new URL(metadata.jwks_uri);
  if (jwksUrl.origin !== issuer) {
    throw new Error("OAuth JWKS must use the authorization-server origin");
  }
  const jwks = jwksSchema.parse(await fetchJson(jwksUrl.href, fetcher));
  const matches = jwks.keys.filter((key) => key.kid === kid);
  if (matches.length !== 1) {
    throw new Error("OAuth access token kid does not identify one JWK");
  }
  const jwk = oauthVerificationJwkSchema.parse(matches[0]);
  const [x, y] = [decodeBase64Url(jwk.x), decodeBase64Url(jwk.y)];
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("OAuth verification JWK coordinates are invalid");
  }
  const compressedKey = new Uint8Array(new ArrayBuffer(33));
  compressedKey[0] = (y[31] ?? 0) % 2 === 0 ? 2 : 3;
  compressedKey.set(x, 1);
  const verificationKey = await Secp256k1PublicKey.importRaw(compressedKey);
  const normalizedJwk = await verificationKey.exportPublicKey("jwk");
  if (normalizedJwk.x !== jwk.x || normalizedJwk.y !== jwk.y) {
    throw new Error("OAuth verification JWK point is invalid");
  }
  return verificationKey;
};

export const verifyOAuthAccessToken = async (
  token: string,
  issuer: string,
  audience: string,
  fetcher: typeof fetch = fetch,
  now = Math.floor(Date.now() / 1000)
): Promise<OAuthAccessTokenClaims> => {
  const parts = token.split(".");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (
    parts.length !== 3 ||
    !encodedHeader ||
    !encodedPayload ||
    !encodedSignature
  ) {
    throw new Error("OAuth access token must be a compact JWT");
  }
  const header = protectedHeaderSchema.parse(
    JSON.parse(decoder.decode(decodeBase64Url(encodedHeader)))
  );
  const claims = oauthAccessTokenClaimsSchema.parse(
    JSON.parse(decoder.decode(decodeBase64Url(encodedPayload)))
  );
  const signingInput = new Uint8Array(
    encoder.encode(`${encodedHeader}.${encodedPayload}`)
  );
  const verificationKey = await resolveOAuthVerificationKey(
    issuer,
    header.kid,
    fetcher
  );
  const valid = await verificationKey.verify(
    decodeBase64Url(encodedSignature),
    signingInput
  );
  if (!valid) {
    throw new Error("OAuth access token signature is invalid");
  }
  if (claims.iss !== issuer) {
    throw new Error("OAuth access token iss claim is invalid");
  }
  if (claims.aud !== audience) {
    throw new Error("OAuth access token aud claim is invalid");
  }
  if (
    claims.exp <= now ||
    claims.iat > now ||
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > OAUTH_ACCESS_TOKEN_MAX_LIFETIME_SECONDS
  ) {
    throw new Error("OAuth access token lifetime is invalid");
  }
  if (!claims.scope.split(" ").includes("atproto")) {
    throw new Error("OAuth access token scope is invalid");
  }
  return claims;
};
