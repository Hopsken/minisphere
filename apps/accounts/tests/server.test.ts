import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const request = (path: string): Promise<Response> =>
  exports.default.fetch(new Request(`https://accounts.test${path}`));

describe("accounts server", () => {
  it("mounts Better Auth", async () => {
    const response = await request("/api/auth/ok");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ ok: true });
  });

  it("applies the Better Auth schema migration", async () => {
    const tableNames = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user', 'session', 'account', 'verification') ORDER BY name"
    ).all<{ name: string }>();

    expect(tableNames.results).toStrictEqual([
      { name: "account" },
      { name: "session" },
      { name: "user" },
      { name: "verification" },
    ]);
  });
});
