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

  it("resolves handles from authoritative account records", async () => {
    const did = "did:plc:alice0000000000000000000";
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, username, did)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind("alice-id", "alice", "alice@r2d2.party", true, "alice", did)
      .run();

    await expect(
      exports.AccountsEntrypoint.resolveHandle("alice.r2d2.party")
    ).resolves.toBe(did);
    await expect(
      Promise.all([
        exports.AccountsEntrypoint.resolveHandle("unknown.r2d2.party"),
        exports.AccountsEntrypoint.resolveHandle("alice.example.com"),
        exports.AccountsEntrypoint.resolveHandle("nested.alice.r2d2.party"),
      ])
    ).resolves.toStrictEqual([null, null, null]);
  });
});
