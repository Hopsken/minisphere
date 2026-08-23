import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const request = (path: string): Promise<Response> =>
  exports.default.fetch(new Request(`https://handle-registry.test${path}`));

describe("handle registry server", () => {
  it("identifies the service", async () => {
    const response = await request("/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      name: "minisphere-handle-registry",
    });
  });

  it("reports database health", async () => {
    const response = await request("/_health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ status: "ok" });
  });

  it("applies the handle schema migration", async () => {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'handles'"
    ).first<{ name: string }>();

    expect(result).toStrictEqual({ name: "handles" });
  });
});
