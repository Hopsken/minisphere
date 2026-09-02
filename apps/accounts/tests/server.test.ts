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
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user', 'session', 'account', 'verification', 'atproto_account', 'user-relationships') ORDER BY name"
    ).all<{ name: string }>();

    expect(tableNames.results).toStrictEqual([
      { name: "account" },
      { name: "atproto_account" },
      { name: "session" },
      { name: "user" },
      { name: "verification" },
    ]);
  });

  it("resolves handles from authoritative account records", async () => {
    const did = "did:plc:alice0000000000000000000";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user (id, name, email, email_verified)
         VALUES (?, ?, ?, ?)`
      ).bind("alice-id", "alice", "alice@example.com", true),
      env.DB.prepare(
        `INSERT INTO atproto_account
          (user_id, username, did, operation_id, status)
         VALUES (?, ?, ?, ?, 'active')`
      ).bind("alice-id", "alice", did, "alice-operation"),
    ]);

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

  it("does not resolve a handle while provisioning is incomplete", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user (id, name, email, email_verified)
         VALUES (?, ?, ?, ?)`
      ).bind("waiting-id", "waiting", "waiting@example.com", true),
      env.DB.prepare(
        `INSERT INTO atproto_account
          (user_id, username, operation_id, status)
         VALUES (?, ?, ?, 'provisioning')`
      ).bind("waiting-id", "waiting", "waiting-operation"),
    ]);

    await expect(
      exports.AccountsEntrypoint.resolveHandle("waiting.r2d2.party")
    ).resolves.toBeNull();
  });
});
