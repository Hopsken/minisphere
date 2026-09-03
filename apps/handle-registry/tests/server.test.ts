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

  it("resolves a handle through the XRPC endpoint", async () => {
    const response = await request(
      "handle-registry.test",
      "/xrpc/com.atproto.identity.resolveHandle?handle=alice.r2d2.party"
    );

    expect({
      allowOrigin: response.headers.get("access-control-allow-origin"),
      status: response.status,
    }).toStrictEqual({ allowOrigin: "*", status: 200 });
    await expect(response.json()).resolves.toStrictEqual({
      did: "did:plc:alice0000000000000000000",
    });
  });

  it("returns an XRPC error for an unknown handle", async () => {
    const response = await request(
      "handle-registry.test",
      "/xrpc/com.atproto.identity.resolveHandle?handle=unknown.r2d2.party"
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      error: "HandleNotFound",
      message: "Handle not found",
    });
  });
});
