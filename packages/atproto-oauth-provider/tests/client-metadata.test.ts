import { describe, expect, it, vi } from "vitest";

import {
  redirectUriMatches,
  resolveAtprotoClientMetadata,
} from "../src/client-metadata";

const clientId = "https://client.example.com/oauth-client-metadata.json";

const validMetadata = {
  application_type: "web",
  client_id: clientId,
  dpop_bound_access_tokens: true,
  grant_types: ["authorization_code", "refresh_token"],
  redirect_uris: ["https://client.example.com/callback"],
  response_types: ["code"],
  scope: "atproto transition:generic",
  token_endpoint_auth_method: "none",
};

type JsonValue =
  | boolean
  | JsonObject
  | JsonValue[]
  | null
  | number
  | string
  | undefined;

interface JsonObject {
  [key: string]: JsonValue;
}

const metadataResponse = (
  metadata: JsonObject = validMetadata,
  init: ResponseInit = {}
) => {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return Response.json(metadata, { ...init, headers });
};

const fetcherReturning = (response: Response) =>
  vi.fn<typeof fetch>(() => Promise.resolve(response));

describe("AT Protocol client metadata", () => {
  it("resolves the exact localhost public-client convention", async () => {
    const metadata = await resolveAtprotoClientMetadata(
      "http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback&scope=atproto"
    );

    expect(metadata).toStrictEqual({
      applicationType: "native",
      clientId:
        "http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%2Fcallback&scope=atproto",
      grantTypes: ["authorization_code", "refresh_token"],
      redirectUris: ["http://127.0.0.1/callback"],
      scopes: ["atproto"],
    });
    expect(
      redirectUriMatches("http://127.0.0.1:49152/callback", metadata)
    ).toBeTruthy();
    expect(
      redirectUriMatches("http://localhost:49152/callback", metadata)
    ).toBeFalsy();
  });

  it("uses both IP loopback defaults", async () => {
    await expect(
      resolveAtprotoClientMetadata("http://localhost/")
    ).resolves.toMatchObject({
      redirectUris: ["http://127.0.0.1/", "http://[::1]/"],
      scopes: ["atproto"],
    });
  });

  it.each([
    "http://localhost:3000",
    "http://localhost/path",
    "http://localhost?unknown=value",
    "http://localhost?scope=atproto&scope=atproto",
    "http://localhost?redirect_uri=http%3A%2F%2Flocalhost%2Fcallback",
  ])("rejects invalid localhost client metadata: %s", async (value) => {
    await expect(resolveAtprotoClientMetadata(value)).rejects.toThrow(/./u);
  });

  it("fetches a public metadata document without redirects", async () => {
    const fetcher = fetcherReturning(metadataResponse());

    await expect(
      resolveAtprotoClientMetadata(clientId, fetcher)
    ).resolves.toStrictEqual({
      applicationType: "web",
      clientId,
      grantTypes: ["authorization_code", "refresh_token"],
      redirectUris: ["https://client.example.com/callback"],
      scopes: ["atproto", "transition:generic"],
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL(clientId),
      expect.objectContaining({ redirect: "manual" })
    );
  });

  it("accepts a native reversed-domain callback", async () => {
    const fetcher = fetcherReturning(
      metadataResponse({
        ...validMetadata,
        application_type: "native",
        redirect_uris: ["com.example.client:/oauth/callback"],
      })
    );

    await expect(
      resolveAtprotoClientMetadata(clientId, fetcher)
    ).resolves.toMatchObject({ applicationType: "native" });
  });

  it.each([
    ["redirect response", metadataResponse({}, { status: 302 })],
    [
      "wrong content type",
      metadataResponse(validMetadata, {
        headers: { "Content-Type": "text/plain" },
      }),
    ],
    [
      "different client ID",
      metadataResponse({
        ...validMetadata,
        client_id: "https://other.example.com/client",
      }),
    ],
    [
      "confidential client key",
      metadataResponse({ ...validMetadata, jwks: { keys: [] } }),
    ],
    [
      "native callback fragment",
      metadataResponse({
        ...validMetadata,
        application_type: "native",
        redirect_uris: ["com.example.client:/callback#fragment"],
      }),
    ],
    [
      "missing public authentication method",
      metadataResponse({
        ...validMetadata,
        token_endpoint_auth_method: undefined,
      }),
    ],
    [
      "non-public authentication method",
      metadataResponse({
        ...validMetadata,
        token_endpoint_auth_method: "private_key_jwt",
      }),
    ],
    [
      "disabled DPoP binding",
      metadataResponse({
        ...validMetadata,
        dpop_bound_access_tokens: false,
      }),
    ],
    [
      "unsupported grant",
      metadataResponse({
        ...validMetadata,
        grant_types: ["client_credentials"],
      }),
    ],
  ])("rejects a %s", async (_name, response) => {
    await expect(
      resolveAtprotoClientMetadata(clientId, fetcherReturning(response))
    ).rejects.toThrow(/./u);
  });

  it.each([
    "http://127.0.0.1/client",
    "https://localhost/client",
    "https://intranet/client",
    "https://client.example/oauth-client-metadata.json",
    "https://client.example.com",
    "https://client.example.com:8443/client",
    "https://client.example.com/client/",
  ])("does not fetch a non-public client ID: %s", async (value) => {
    const fetcher = fetcherReturning(metadataResponse());
    await expect(resolveAtprotoClientMetadata(value, fetcher)).rejects.toThrow(
      /./u
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
