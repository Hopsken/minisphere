import { describe, expect, it } from "vitest";

import { getBrowserConfiguration } from "../src/lib/oauth";

const configuration = {
  clientId: "https://town.example.com/oauth-client-metadata.json",
  redirectUri: "https://town.example.com/oauth/callback",
  scope: "atproto repo?collection=app.bsky.feed.post&action=create",
};

describe("OAuth browser configuration", () => {
  it("carries the write scope into the loopback Client ID", () => {
    const result = getBrowserConfiguration(
      configuration,
      new URL("http://127.0.0.1:5174")
    );
    const clientId = new URL(result.clientId);
    expect(clientId.origin).toBe("http://localhost");
    expect(clientId.searchParams.get("scope")).toBe(configuration.scope);
    expect(clientId.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:5174/oauth/callback"
    );
  });

  it("keeps the canonical public metadata and redirect on a portal", () => {
    expect(
      getBrowserConfiguration(
        configuration,
        new URL("https://town.example.com")
      )
    ).toStrictEqual(configuration);
  });
});
