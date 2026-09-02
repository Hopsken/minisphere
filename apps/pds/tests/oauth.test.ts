import { parsePrivateMultikey, Secp256k1PrivateKey } from "@atcute/crypto";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { verifyOAuthAccessToken } from "../src/auth/oauth";

const accountsOrigin = "https://accounts.test";
const pdsOrigin = "https://pds.test";
const subject = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const jwkThumbprint = "a".repeat(43);

const tokenInput = {
  audience: pdsOrigin,
  clientId: "https://client.example/oauth-client-metadata.json",
  expiresIn: 300,
  issuer: accountsOrigin,
  jwkThumbprint,
  scope: "atproto",
  subject,
};

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

const getSigningKey = () => {
  const parsedKey = parsePrivateMultikey(env.TEST_ACCOUNTS_OAUTH_SIGNING_KEY);
  if (parsedKey.type !== "secp256k1") {
    throw new Error("Test OAuth signing key must use secp256k1");
  }
  return Secp256k1PrivateKey.importRaw(parsedKey.privateKeyBytes);
};

const oauthMetadataFetch: typeof fetch = async (input) => {
  const url = new URL(new Request(input).url);
  if (url.href === `${accountsOrigin}/.well-known/oauth-authorization-server`) {
    return Response.json({
      issuer: accountsOrigin,
      jwks_uri: `${accountsOrigin}/oauth/jwks`,
    });
  }
  if (url.href === `${accountsOrigin}/oauth/jwks`) {
    const key = await getSigningKey();
    return Response.json({
      keys: [
        {
          ...(await key.exportPublicKey("jwk")),
          alg: "ES256K",
          key_ops: ["verify"],
          kid: await key.exportPublicKey("did"),
          use: "sig",
        },
      ],
    });
  }
  return new Response("Not Found", { status: 404 });
};

const createAccessToken = async (
  overrides: Partial<typeof tokenInput> & { issuedAt?: number } = {}
) => {
  const input = { ...tokenInput, ...overrides };
  const key = await getSigningKey();
  const issuedAt = overrides.issuedAt ?? Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        alg: "ES256K",
        kid: await key.exportPublicKey("did"),
        typ: "at+jwt",
      })
    )
  );
  const payload = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        aud: input.audience,
        client_id: input.clientId,
        cnf: { jkt: input.jwkThumbprint },
        exp: issuedAt + input.expiresIn,
        iat: issuedAt,
        iss: input.issuer,
        jti: crypto.randomUUID(),
        scope: input.scope,
        sub: input.subject,
      })
    )
  );
  const signingInput = `${header}.${payload}`;
  const signature = await key.sign(encoder.encode(signingInput));
  return `${signingInput}.${encodeBase64Url(signature)}`;
};

describe("PDS OAuth resource contract", () => {
  it("publishes protected-resource metadata", async () => {
    const response = await exports.default.fetch(
      new Request(`${pdsOrigin}/.well-known/oauth-protected-resource`)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    await expect(response.json()).resolves.toStrictEqual({
      authorization_servers: [accountsOrigin],
      resource: pdsOrigin,
    });
  });

  it("verifies an Accounts-issued token with DID, audience, and DPoP claims", async () => {
    const token = await createAccessToken();
    const claims = await verifyOAuthAccessToken(
      token,
      accountsOrigin,
      pdsOrigin,
      oauthMetadataFetch
    );

    expect(claims).toMatchObject({
      aud: pdsOrigin,
      client_id: tokenInput.clientId,
      cnf: { jkt: jwkThumbprint },
      iss: accountsOrigin,
      scope: "atproto",
      sub: subject,
    });
    expect(claims.exp - claims.iat).toBe(300);
    expect(claims.jti).toStrictEqual(expect.any(String));
  });

  it("rejects the wrong audience during token verification", async () => {
    const token = await createAccessToken();
    await expect(
      verifyOAuthAccessToken(
        token,
        accountsOrigin,
        "https://other-pds.example",
        oauthMetadataFetch
      )
    ).rejects.toThrow(/aud/u);
  });

  it("rejects an access token with a lifetime beyond five minutes", async () => {
    const token = await createAccessToken({ expiresIn: 301 });
    await expect(
      verifyOAuthAccessToken(
        token,
        accountsOrigin,
        pdsOrigin,
        oauthMetadataFetch
      )
    ).rejects.toThrow(/lifetime/u);
  });

  it("rejects an access token issued in the future", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await createAccessToken({ issuedAt: now + 60 });
    await expect(
      verifyOAuthAccessToken(
        token,
        accountsOrigin,
        pdsOrigin,
        oauthMetadataFetch,
        now
      )
    ).rejects.toThrow(/lifetime/u);
  });

  it("rejects a token not signed by Accounts", async () => {
    const token = await createAccessToken();
    const parts = token.split(".");
    const signature = parts[2] ?? "";
    const replacement = signature.startsWith("A") ? "B" : "A";
    parts[2] = `${replacement}${signature.slice(1)}`;
    await expect(
      verifyOAuthAccessToken(
        parts.join("."),
        accountsOrigin,
        pdsOrigin,
        oauthMetadataFetch
      )
    ).rejects.toThrow(/signature/u);
  });
});
