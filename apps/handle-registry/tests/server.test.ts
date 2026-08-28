import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const request = (hostname: string, path: string): Promise<Response> =>
  exports.default.fetch(new Request(`https://${hostname}${path}`));

describe("handle registry server", () => {
  it("identifies the service", async () => {
    const response = await request("handle-registry.test", "/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      name: "minisphere-handle-registry",
    });
  });

  it("reports stateless service health", async () => {
    const response = await request("handle-registry.test", "/_health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ status: "ok" });
  });

  it("serves the DID provided by Accounts", async () => {
    const response = await request(
      "alice.r2d2.party",
      "/.well-known/atproto-did"
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe(
      "did:plc:alice0000000000000000000"
    );
  });

  it("returns 404 when Accounts does not resolve the handle", async () => {
    const response = await request(
      "unknown.r2d2.party",
      "/.well-known/atproto-did"
    );

    expect(response.status).toBe(404);
  });
});
