import { env, exports } from "cloudflare:workers";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { JWK, JWTPayload } from "jose";
import { expect } from "vitest";
import { z } from "zod";

export const origin = "https://accounts.test";
export const redirectUri = "http://127.0.0.1:3000/callback";
export const clientId = `http://localhost?redirect_uri=${encodeURIComponent("http://127.0.0.1/callback")}&scope=atproto`;
export const accountDid = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";

const parResponseSchema = z.object({
  expires_in: z.number(),
  request_uri: z.string(),
});
export const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string(),
  scope: z.string(),
  sub: z.string(),
  token_type: z.literal("DPoP"),
});
export const errorResponseSchema = z.object({ error: z.string() });
const authorizationDetailsSchema = z.object({
  clientId: z.string(),
  scope: z.string(),
  subject: z.object({
    did: z.string(),
    displayName: z.string().optional(),
    handle: z.string().optional(),
  }),
});

export interface DpopKey {
  privateKey: CryptoKey;
  publicJwk: JWK;
}

interface DpopClaims extends JWTPayload {
  htm: string;
  htu: string;
  iat: number;
  jti: string;
  nonce?: string;
}

export const request = (path: string, init: RequestInit = {}) =>
  exports.default.fetch(
    new Request(`${origin}${path}`, { redirect: "manual", ...init })
  );

export const createDpopKey = async (): Promise<DpopKey> => {
  const keyPair = await generateKeyPair("ES256", { extractable: true });
  return {
    privateKey: keyPair.privateKey,
    publicJwk: await exportJWK(keyPair.publicKey),
  };
};

export const createDpopProof = (
  key: DpopKey,
  path: string,
  nonce?: string,
  jti = crypto.randomUUID()
) => {
  const claims: DpopClaims = {
    htm: "POST",
    htu: `${origin}${path}`,
    iat: Math.floor(Date.now() / 1000),
    jti,
  };
  if (nonce) {
    claims.nonce = nonce;
  }
  return new SignJWT(claims)
    .setProtectedHeader({
      alg: "ES256",
      jwk: key.publicJwk,
      typ: "dpop+jwt",
    })
    .sign(key.privateKey);
};

export const pkceChallenge = async (verifier: string) => {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  );
  let binary = "";
  for (const byte of hash) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export const parBody = (challenge: string, state: string) =>
  new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "atproto",
    state,
  }).toString();

export const postOAuth = async (
  path: string,
  body: string,
  key: DpopKey,
  nonce?: string,
  proof?: string
) =>
  request(path, {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      DPoP: proof ?? (await createDpopProof(key, path, nonce)),
    },
    method: "POST",
  });

export const createPar = async (
  key: DpopKey,
  challenge: string,
  state: string,
  nonce?: string
) => {
  let serverNonce = nonce;
  if (!serverNonce) {
    const challengeResponse = await postOAuth(
      "/oauth/par",
      parBody(challenge, state),
      key
    );
    expect(challengeResponse.status).toBe(400);
    expect(
      errorResponseSchema.parse(await challengeResponse.json()).error
    ).toBe("use_dpop_nonce");
    serverNonce = challengeResponse.headers.get("DPoP-Nonce") ?? undefined;
    expect(serverNonce).toStrictEqual(expect.any(String));
  }

  const response = await postOAuth(
    "/oauth/par",
    parBody(challenge, state),
    key,
    serverNonce
  );
  expect(response.status).toBe(201);
  return {
    nonce: response.headers.get("DPoP-Nonce") ?? "",
    par: parResponseSchema.parse(await response.json()),
  };
};

export const loginActiveUser = async () => {
  const login = await request(
    "/__dev/log-me-in/oauth-user%40example.com?returnTo=%2F"
  );
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  const user = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
    .bind("oauth-user@example.com")
    .first<{ id: string }>();
  if (!cookie || !user) {
    throw new Error("Development user login failed");
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO atproto_account
      (user_id, username, did, signing_key, status)
     VALUES (?, ?, ?, ?, 'active')`
  )
    .bind(user.id, "account", accountDid, "did:key:zQ3shOAuthSigningKey")
    .run();
  return cookie;
};

export const getAuthorizationConsent = async (
  requestUri: string,
  cookie: string
) => {
  const redirect = await request(
    `/oauth/authorize?client_id=${encodeURIComponent(clientId)}&request_uri=${encodeURIComponent(requestUri)}`,
    { headers: { cookie } }
  );
  expect(redirect.status).toBe(302);
  const location = new URL(redirect.headers.get("location") ?? "", origin);
  expect(location.pathname).toBe("/authorize");
  const consentToken = location.searchParams.get("consent_token");
  expect(consentToken).toStrictEqual(expect.any(String));

  const parameters = new URLSearchParams({
    consent_token: consentToken ?? "",
  });
  const detailsResponse = await request(
    `/oauth/authorization-details?${parameters.toString()}`,
    { headers: { cookie } }
  );
  expect(detailsResponse.status).toBe(200);
  return {
    consentToken: consentToken ?? "",
    details: authorizationDetailsSchema.parse(await detailsResponse.json()),
  };
};

export const authorizePar = async (requestUri: string, cookie: string) => {
  const { consentToken } = await getAuthorizationConsent(requestUri, cookie);

  return request("/oauth/authorize", {
    body: new URLSearchParams({
      consent_token: consentToken,
      decision: "allow",
    }).toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: origin,
      cookie,
    },
    method: "POST",
  });
};
