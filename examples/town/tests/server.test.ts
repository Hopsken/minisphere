import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const request = (path: string) =>
  exports.default.fetch(new Request(`https://town.hopsken.dev${path}`));

describe("Town server", () => {
  it("serves its public OAuth client metadata", async () => {
    const response = await request("/oauth-client-metadata.json");

    expect({
      cacheControl: response.headers.get("cache-control"),
      status: response.status,
    }).toStrictEqual({
      cacheControl: "public, max-age=300",
      status: 200,
    });
    await expect(response.json()).resolves.toStrictEqual({
      application_type: "web",
      client_id: "https://town.hopsken.dev/oauth-client-metadata.json",
      client_name: "Town",
      client_uri: "https://town.hopsken.dev",
      dpop_bound_access_tokens: true,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["https://town.hopsken.dev/oauth/callback"],
      response_types: ["code"],
      scope: "atproto",
      token_endpoint_auth_method: "none",
    });
  });

  it("returns the OAuth client configuration", async () => {
    const response = await request("/api/configuration");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      clientId: "https://town.hopsken.dev/oauth-client-metadata.json",
      handleResolverOrigin: "https://pds.hopsken.dev",
      redirectUri: "https://town.hopsken.dev/oauth/callback",
      scope: "atproto",
    });
  });

  it("serves PLC documents for Atcute identity verification", async () => {
    const response = await request(
      "/api/did-documents/did%3Aplc%3Aaaaaaaaaaaaaaaaaaaaaaaaa"
    );

    expect({
      contentType: response.headers.get("content-type"),
      status: response.status,
    }).toStrictEqual({
      contentType: "application/did+ld+json",
      status: 200,
    });
    await expect(response.json()).resolves.toMatchObject({
      alsoKnownAs: ["at://alice.r2d2.party"],
      id: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("resolves the logged-in DID handle through PLC", async () => {
    const response = await request(
      "/api/identities/did%3Aplc%3Aaaaaaaaaaaaaaaaaaaaaaaaa"
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      did: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
      handle: "alice.r2d2.party",
    });
  });

  it("rejects an invalid DID", async () => {
    const response = await request("/api/identities/not-a-did");

    expect(response.status).toBe(400);
  });
});
