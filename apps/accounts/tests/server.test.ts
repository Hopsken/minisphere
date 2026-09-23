import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import app from "../worker";

const request = (path: string): Promise<Response> =>
  exports.default.fetch(new Request(`https://accounts.test${path}`));

describe("accounts server", () => {
  it("uses the paired origin for OAuth metadata, not the request host", async () => {
    const bindings = { ...env, MINISPHERE_ORIGIN: "https://r2d2.party" };
    for (const key of ["PUBLIC_HANDLE_DOMAIN", "PDS_ORIGIN"]) {
      Reflect.deleteProperty(bindings, key);
    }
    const foreignOrigin = await app.request(
      "https://untrusted.example/.well-known/oauth-authorization-server",
      {},
      bindings
    );
    expect(foreignOrigin.status).toBe(404);
    const response = await app.request(
      "https://r2d2.party/.well-known/oauth-authorization-server",
      {},
      bindings
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      authorization_endpoint: "https://r2d2.party/oauth/authorize",
      issuer: "https://r2d2.party",
      token_endpoint: "https://r2d2.party/oauth/token",
    });
  });

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
          (user_id, username, did, signing_key, operation, encrypted_rotation_key, rotation_key_iv, status)
         VALUES (?, ?, ?, ?, '{}', 'fixture-ciphertext', 'fixture-iv', 'active')`
      ).bind("alice-id", "alice", did, "did:key:zQ3shAliceSigningKey"),
    ]);

    const wellKnown = await exports.default.fetch(
      new Request("https://alice.r2d2.party/.well-known/atproto-did")
    );
    expect({
      body: await wellKnown.text(),
      contentType: wellKnown.headers.get("content-type"),
      cookie: wellKnown.headers.get("set-cookie"),
      status: wellKnown.status,
    }).toStrictEqual({
      body: did,
      contentType: expect.stringMatching(/^text\/plain(?:;|$)/u),
      cookie: null,
      status: 200,
    });

    const xrpc = await request(
      "/xrpc/com.atproto.identity.resolveHandle?handle=ALICE.R2D2.PARTY"
    );
    expect({
      body: await xrpc.json(),
      cookie: xrpc.headers.get("set-cookie"),
      cors: xrpc.headers.get("access-control-allow-origin"),
      status: xrpc.status,
    }).toStrictEqual({ body: { did }, cookie: null, cors: "*", status: 200 });

    await Promise.all(
      [
        "unknown.r2d2.party",
        "alice.example.com",
        "nested.alice.r2d2.party",
        "r2d2.party",
        "alice.notr2d2.party",
      ].map(async (handle) => {
        const absent = await exports.default.fetch(
          new Request(`https://${handle}/.well-known/atproto-did`)
        );
        expect(absent.status).toBe(404);
        const unresolved = await request(
          `/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`
        );
        expect(unresolved.status).toBe(400);
        await expect(unresolved.json()).resolves.toStrictEqual({
          error: "HandleNotFound",
          message: "Handle not found",
        });
      })
    );
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

    const response = await request(
      "/xrpc/com.atproto.identity.resolveHandle?handle=waiting.r2d2.party"
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      error: "HandleNotFound",
      message: "Handle not found",
    });
  });

  it.each(["", "?handle=invalid", "?handle=alice..r2d2.party"])(
    "rejects invalid XRPC handle input %s",
    async (query) => {
      const response = await request(
        `/xrpc/com.atproto.identity.resolveHandle${query}`
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({
        error: "InvalidRequest",
        message: "A valid handle is required",
      });
    }
  );

  it("limits public CORS to the handle resolver", async () => {
    const preflight = await exports.default.fetch(
      new Request(
        "https://accounts.test/xrpc/com.atproto.identity.resolveHandle",
        {
          headers: {
            "Access-Control-Request-Method": "GET",
            Origin: "https://client.example",
          },
          method: "OPTIONS",
        }
      )
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    const login = await request("/api/auth/ok");
    expect(login.headers.get("access-control-allow-origin")).not.toBe("*");
  });
});
