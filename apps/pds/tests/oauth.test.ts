import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createOAuthAccessToken,
  verifyOAuthAccessToken,
} from "../src/auth/session";

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

  it("issues a short-lived access token with DID, audience, and DPoP claims", async () => {
    const token =
      await exports.PdsControlPlane.issueOAuthAccessToken(tokenInput);
    const claims = await verifyOAuthAccessToken(
      token,
      accountsOrigin,
      pdsOrigin,
      env.PDS_JWT_SECRET
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
    const token =
      await exports.PdsControlPlane.issueOAuthAccessToken(tokenInput);
    await expect(
      verifyOAuthAccessToken(
        token,
        accountsOrigin,
        "https://other-pds.example",
        env.PDS_JWT_SECRET
      )
    ).rejects.toThrow(/aud/u);
  });

  it("does not issue an access token beyond five minutes", () => {
    expect(() =>
      createOAuthAccessToken(
        { ...tokenInput, expiresIn: 301 },
        env.PDS_JWT_SECRET
      )
    ).toThrow(/300/u);
  });
});
