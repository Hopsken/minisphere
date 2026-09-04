import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { getConfig } from "../worker/config";
import { createDatabase } from "../worker/db";
import { createAuth } from "../worker/lib/better-auth";

const request = (path: string): Promise<Response> =>
  exports.default.fetch(new Request(`https://accounts.test${path}`));

describe("accounts server", () => {
  it("reports valid configuration health", async () => {
    const response = await request("/health");

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  it("reports that OIDC sign-in is unavailable", async () => {
    const response = await request("/api/configuration");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      oidcProviderName: null,
    });
  });

  it("mounts Better Auth", async () => {
    const response = await request("/api/auth/ok");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ ok: true });
  });

  it("mounts the OIDC provider when it is configured", async () => {
    const auth = createAuth(
      {
        ...getConfig(),
        oidc: {
          clientId: "accounts-test-client",
          clientSecret: "accounts-test-client-secret",
          discoveryUrl: "https://oidc.test/.well-known/openid-configuration",
          providerName: "Test Identity",
        },
      },
      createDatabase(env.DB)
    );
    const response = await auth.handler(
      new Request("https://accounts.test/api/auth/sign-in/social", {
        body: JSON.stringify({ callbackURL: "/", provider: "oidc" }),
        headers: {
          "content-type": "application/json",
          origin: "https://accounts.test",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      redirect: true,
      url: expect.stringMatching(/^https:\/\/oidc\.test\/authorize\?/u),
    });
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
          (user_id, username, did, signing_key, status)
         VALUES (?, ?, ?, ?, 'active')`
      ).bind("alice-id", "alice", did, "did:key:zQ3shAliceSigningKey"),
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
          (user_id, username, status)
         VALUES (?, ?, 'provisioning')`
      ).bind("waiting-id", "waiting"),
    ]);

    await expect(
      exports.AccountsEntrypoint.resolveHandle("waiting.r2d2.party")
    ).resolves.toBeNull();
  });
});
