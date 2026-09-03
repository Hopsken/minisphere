import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authorizePar,
  accountDid,
  clientId,
  createDpopKey,
  createDpopProof,
  createPar,
  errorResponseSchema,
  getAuthorizationConsent,
  loginActiveUser,
  origin,
  parBody,
  parResponseSchema,
  pkceChallenge,
  postOAuth,
  postOAuthJson,
  redirectUri,
  request,
  tokenResponseSchema,
} from "./atproto-oauth-test-helpers";

describe("AT Protocol OAuth authorization server", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM verification").run();
  });

  it("publishes truthful public-client metadata and protocol CORS", async () => {
    const response = await request("/.well-known/oauth-authorization-server");
    expect({
      allowOrigin: response.headers.get("access-control-allow-origin"),
      status: response.status,
    }).toStrictEqual({ allowOrigin: "*", status: 200 });
    await expect(response.json()).resolves.toStrictEqual({
      authorization_endpoint: `${origin}/oauth/authorize`,
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
      dpop_signing_alg_values_supported: ["ES256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      issuer: origin,
      jwks_uri: `${origin}/oauth/jwks`,
      pushed_authorization_request_endpoint: `${origin}/oauth/par`,
      request_uri_parameter_supported: true,
      require_pushed_authorization_requests: true,
      response_modes_supported: ["fragment", "query"],
      response_types_supported: ["code"],
      revocation_endpoint: `${origin}/oauth/revoke`,
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["atproto"],
      token_endpoint: `${origin}/oauth/token`,
      token_endpoint_auth_methods_supported: ["none"],
    });

    const jwksResponse = await request("/oauth/jwks");
    expect({
      allowOrigin: jwksResponse.headers.get("access-control-allow-origin"),
      cacheControl: jwksResponse.headers.get("cache-control"),
      status: jwksResponse.status,
    }).toStrictEqual({
      allowOrigin: "*",
      cacheControl: "public, max-age=300",
      status: 200,
    });
    await expect(jwksResponse.json()).resolves.toStrictEqual({
      keys: [
        {
          alg: "ES256K",
          crv: "secp256k1",
          key_ops: ["verify"],
          kid: expect.stringMatching(/^did:key:/u),
          kty: "EC",
          use: "sig",
          x: expect.stringMatching(/^[A-Za-z\d_-]{43}$/u),
          y: expect.stringMatching(/^[A-Za-z\d_-]{43}$/u),
        },
      ],
    });

    const preflight = await request("/oauth/token", { method: "OPTIONS" });
    expect({
      allowHeaders: preflight.headers.get("access-control-allow-headers"),
      exposesNonce: preflight.headers
        .get("access-control-expose-headers")
        ?.includes("DPoP-Nonce"),
      status: preflight.status,
    }).toStrictEqual({
      allowHeaders: "Content-Type, DPoP",
      exposesNonce: true,
      status: 200,
    });
  });

  it("rejects invalid Hono route methods and form transport", async () => {
    const metadataHead = await request(
      "/.well-known/oauth-authorization-server",
      { method: "HEAD" }
    );
    expect(metadataHead.status).toBe(405);

    const protocolGet = await request("/oauth/par");
    expect({
      error: errorResponseSchema.parse(await protocolGet.json()).error,
      status: protocolGet.status,
    }).toStrictEqual({ error: "invalid_request", status: 405 });

    const oversized = await request("/oauth/par", {
      body: `state=${"a".repeat(16 * 1024)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect({
      error: errorResponseSchema.parse(await oversized.json()).error,
      hasNonce: Boolean(oversized.headers.get("DPoP-Nonce")),
      status: oversized.status,
    }).toStrictEqual({
      error: "invalid_request",
      hasNonce: true,
      status: 400,
    });

    const key = await createDpopKey();
    const wrongContentType = await request("/oauth/par", {
      body: parBody(await pkceChallenge("t".repeat(64)), "content-type-state"),
      headers: {
        "Content-Type": "text/plain",
        DPoP: await createDpopProof(
          key,
          "/oauth/par",
          oversized.headers.get("DPoP-Nonce") ?? ""
        ),
      },
      method: "POST",
    });
    expect({
      error: errorResponseSchema.parse(await wrongContentType.json()).error,
      status: wrongContentType.status,
    }).toStrictEqual({ error: "invalid_request", status: 400 });

    const duplicate = await postOAuth(
      "/oauth/par",
      `${parBody(await pkceChallenge("u".repeat(64)), "first-state")}&state=second-state`,
      key,
      wrongContentType.headers.get("DPoP-Nonce") ?? ""
    );
    expect({
      error: errorResponseSchema.parse(await duplicate.json()).error,
      status: duplicate.status,
    }).toStrictEqual({ error: "invalid_request", status: 400 });
  });

  it("requires a nonce and rejects DPoP and PKCE replays", async () => {
    const key = await createDpopKey();
    const challenge = await pkceChallenge("a".repeat(64));
    const body = parBody(challenge, "nonce-and-replay-state");
    const firstProof = await createDpopProof(key, "/oauth/par");
    const nonceChallenge = await postOAuth(
      "/oauth/par",
      body,
      key,
      undefined,
      firstProof
    );
    const nonce = nonceChallenge.headers.get("DPoP-Nonce") ?? "";
    expect({
      error: errorResponseSchema.parse(await nonceChallenge.json()).error,
      hasNonce: nonce.length > 0,
      status: nonceChallenge.status,
    }).toStrictEqual({
      error: "use_dpop_nonce",
      hasNonce: true,
      status: 400,
    });

    const validProof = await createDpopProof(key, "/oauth/par", nonce);
    const accepted = await postOAuth(
      "/oauth/par",
      body,
      key,
      nonce,
      validProof
    );
    expect(accepted.status).toBe(201);

    const replay = await postOAuth("/oauth/par", body, key, nonce, validProof);
    expect({
      error: errorResponseSchema.parse(await replay.json()).error,
      status: replay.status,
    }).toStrictEqual({ error: "invalid_dpop_proof", status: 400 });

    const challengeReplay = await postOAuth(
      "/oauth/par",
      parBody(challenge, "different-state"),
      key,
      accepted.headers.get("DPoP-Nonce") ?? nonce
    );
    expect({
      error: errorResponseSchema.parse(await challengeReplay.json()).error,
      status: challengeReplay.status,
    }).toStrictEqual({ error: "invalid_request", status: 400 });
  });

  it("consumes PAR request URIs once and rejects expired requests", async () => {
    const key = await createDpopKey();
    const first = await createPar(
      key,
      await pkceChallenge("b".repeat(64)),
      "single-use-state"
    );
    const authorizationPath = `/oauth/authorize?client_id=${encodeURIComponent(clientId)}&request_uri=${encodeURIComponent(first.par.request_uri)}`;
    const loginRedirect = await request(authorizationPath);
    expect(loginRedirect.status).toBe(302);
    expect(loginRedirect.headers.get("location")).toContain("/login?redirect=");
    const replay = await request(authorizationPath);
    expect(replay.status).toBe(400);

    const second = await createPar(
      key,
      await pkceChallenge("c".repeat(64)),
      "expired-state",
      first.nonce
    );
    await env.DB.prepare(
      "UPDATE verification SET expires_at = 0 WHERE identifier LIKE 'atproto-oauth:par:%'"
    ).run();
    const expired = await request(
      `/oauth/authorize?client_id=${encodeURIComponent(clientId)}&request_uri=${encodeURIComponent(second.par.request_uri)}`
    );
    expect(expired.status).toBe(400);
  });

  it("sends an incomplete user to username onboarding", async () => {
    const login = await request(
      "/__dev/log-me-in/incomplete-oauth-user%40example.com?returnTo=%2F"
    );
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const key = await createDpopKey();
    const pushed = await createPar(
      key,
      await pkceChallenge("g".repeat(64)),
      "incomplete-account-state"
    );

    const response = await request(
      `/oauth/authorize?client_id=${encodeURIComponent(clientId)}&request_uri=${encodeURIComponent(pushed.par.request_uri)}`,
      { headers: { cookie } }
    );

    expect({
      location: response.headers.get("location"),
      status: response.status,
    }).toStrictEqual({
      location: "/onboarding/username?oauth=true",
      status: 302,
    });
  });

  it("rechecks the active subject when consent is submitted", async () => {
    const cookie = await loginActiveUser();
    const key = await createDpopKey();
    const pushed = await createPar(
      key,
      await pkceChallenge("h".repeat(64)),
      "subject-recheck-state"
    );
    const { consentToken, details } = await getAuthorizationConsent(
      pushed.par.request_uri,
      cookie
    );
    expect(details).toStrictEqual({
      clientId,
      scope: "atproto",
      subject: {
        did: accountDid,
        displayName: "account",
        handle: "account.r2d2.party",
      },
    });
    await env.DB.prepare("DELETE FROM atproto_account WHERE did = ?")
      .bind(accountDid)
      .run();

    const response = await request("/oauth/authorize", {
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

    expect({
      error: errorResponseSchema.parse(await response.json()).error,
      status: response.status,
    }).toStrictEqual({ error: "access_denied", status: 400 });
  });

  it("binds the active account DID through code and refresh rotation", async () => {
    const cookie = await loginActiveUser();
    const key = await createDpopKey();

    const verifier = "e".repeat(64);
    const acceptedPar = await createPar(
      key,
      await pkceChallenge(verifier),
      "complete-flow-state"
    );
    const authorization = await authorizePar(
      acceptedPar.par.request_uri,
      cookie
    );
    const authorizationLocation = new URL(
      authorization.headers.get("location") ?? ""
    );
    const code = authorizationLocation.searchParams.get("code") ?? "";
    expect({
      hasCode: code.length > 0,
      issuer: authorizationLocation.searchParams.get("iss"),
      state: authorizationLocation.searchParams.get("state"),
      status: authorization.status,
    }).toStrictEqual({
      hasCode: true,
      issuer: origin,
      state: "complete-flow-state",
      status: 302,
    });

    const codeBody = new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }).toString();
    const codeExchange = await postOAuth(
      "/oauth/token",
      codeBody,
      key,
      acceptedPar.nonce
    );
    const initialTokens = tokenResponseSchema.parse(await codeExchange.json());
    expect({
      status: codeExchange.status,
      tokens: initialTokens,
    }).toMatchObject({
      status: 200,
      tokens: {
        expires_in: 300,
        scope: "atproto",
        sub: accountDid,
        token_type: "DPoP",
      },
    });

    const codeReplay = await postOAuth(
      "/oauth/token",
      codeBody,
      key,
      codeExchange.headers.get("DPoP-Nonce") ?? acceptedPar.nonce
    );
    const codeReplayError = errorResponseSchema.parse(
      await codeReplay.json()
    ).error;

    const refreshBody = new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: initialTokens.refresh_token,
    }).toString();
    const refresh = await postOAuth(
      "/oauth/token",
      refreshBody,
      key,
      codeReplay.headers.get("DPoP-Nonce") ?? acceptedPar.nonce
    );
    const refreshedTokens = tokenResponseSchema.parse(await refresh.json());
    expect({
      refreshRotated:
        refreshedTokens.refresh_token !== initialTokens.refresh_token,
      reusedCode: { error: codeReplayError, status: codeReplay.status },
      status: refresh.status,
      sub: refreshedTokens.sub,
    }).toStrictEqual({
      refreshRotated: true,
      reusedCode: { error: "invalid_grant", status: 400 },
      status: 200,
      sub: accountDid,
    });

    const replay = await postOAuth(
      "/oauth/token",
      refreshBody,
      key,
      refresh.headers.get("DPoP-Nonce") ?? acceptedPar.nonce
    );
    const replayError = errorResponseSchema.parse(await replay.json()).error;

    const revokedByReplay = await postOAuth(
      "/oauth/token",
      new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshedTokens.refresh_token,
      }).toString(),
      key,
      replay.headers.get("DPoP-Nonce") ?? acceptedPar.nonce
    );
    expect({
      replay: { error: replayError, status: replay.status },
      revokedSession: {
        error: errorResponseSchema.parse(await revokedByReplay.json()).error,
        status: revokedByReplay.status,
      },
    }).toStrictEqual({
      replay: { error: "invalid_grant", status: 400 },
      revokedSession: { error: "invalid_grant", status: 400 },
    });
  });

  it("returns authorization results in the requested fragment", async () => {
    const cookie = await loginActiveUser();
    const key = await createDpopKey();
    const verifier = "i".repeat(64);
    const parameters = new URLSearchParams(
      parBody(
        await pkceChallenge(verifier),
        "fragment-response-state",
        "fragment"
      )
    );
    const nonceChallenge = await postOAuthJson("/oauth/par", parameters, key);
    const nonce = nonceChallenge.headers.get("DPoP-Nonce") ?? "";
    expect(nonceChallenge.status).toBe(400);
    const parResponse = await postOAuthJson(
      "/oauth/par",
      parameters,
      key,
      nonce
    );
    expect(parResponse.status).toBe(201);
    const pushed = parResponseSchema.parse(await parResponse.json());

    const authorization = await authorizePar(pushed.request_uri, cookie);
    const location = new URL(authorization.headers.get("location") ?? "");
    const fragment = new URLSearchParams(location.hash.slice(1));

    expect({
      hasCode: Boolean(fragment.get("code")),
      issuer: fragment.get("iss"),
      query: location.search,
      state: fragment.get("state"),
      status: authorization.status,
    }).toStrictEqual({
      hasCode: true,
      issuer: origin,
      query: "",
      state: "fragment-response-state",
      status: 302,
    });

    const tokenResponse = await postOAuthJson(
      "/oauth/token",
      new URLSearchParams({
        client_id: clientId,
        code: fragment.get("code") ?? "",
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      key,
      parResponse.headers.get("DPoP-Nonce") ?? nonce
    );
    expect({
      status: tokenResponse.status,
      sub: tokenResponseSchema.parse(await tokenResponse.json()).sub,
    }).toStrictEqual({ status: 200, sub: accountDid });
  });

  it("requires the session DPoP key for revocation", async () => {
    const cookie = await loginActiveUser();
    const key = await createDpopKey();
    const verifier = "f".repeat(64);
    const pushed = await createPar(
      key,
      await pkceChallenge(verifier),
      "revocation-state"
    );
    const authorization = await authorizePar(pushed.par.request_uri, cookie);
    const code = new URL(
      authorization.headers.get("location") ?? ""
    ).searchParams.get("code");
    const codeExchange = await postOAuth(
      "/oauth/token",
      new URLSearchParams({
        client_id: clientId,
        code: code ?? "",
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
      key,
      pushed.nonce
    );
    const tokens = tokenResponseSchema.parse(await codeExchange.json());
    const revokeBody = new URLSearchParams({
      client_id: clientId,
      token: tokens.access_token,
      token_type_hint: "access_token",
    }).toString();

    const wrongKey = await createDpopKey();
    const wrong = await postOAuth(
      "/oauth/revoke",
      revokeBody,
      wrongKey,
      codeExchange.headers.get("DPoP-Nonce") ?? pushed.nonce
    );
    expect(wrong.status).toBe(400);
    expect(errorResponseSchema.parse(await wrong.json()).error).toBe(
      "invalid_dpop_proof"
    );

    const revoked = await postOAuth(
      "/oauth/revoke",
      revokeBody,
      key,
      wrong.headers.get("DPoP-Nonce") ?? pushed.nonce
    );
    expect(revoked.status).toBe(200);
    expect(revoked.headers.get("DPoP-Nonce")).toStrictEqual(expect.any(String));
  });
});
