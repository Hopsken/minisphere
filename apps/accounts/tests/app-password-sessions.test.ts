/* oxlint-disable vitest/max-expects -- Session flows assert each response at the protocol boundary. */
import { verifySigWithDidKey } from "@atcute/crypto";
import { exports } from "cloudflare:workers";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const origin = "https://minisphere.test";

const appPasswordSchema = z.strictObject({
  createdAt: z.string(),
  id: z.uuid(),
  name: z.string(),
  password: z.string().regex(/^[a-z2-7]{4}(?:-[a-z2-7]{4}){3}$/u),
  privileged: z.boolean(),
});
const sessionSchema = z.strictObject({
  accessJwt: z.string(),
  active: z.literal(true),
  did: z.string(),
  didDoc: z.looseObject({ id: z.string() }).optional(),
  email: z.string(),
  emailConfirmed: z.boolean(),
  handle: z.string(),
  refreshJwt: z.string(),
});
const errorSchema = z.object({ error: z.string(), message: z.string() });

const fetchAccounts = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`${origin}${path}`, init));

const signUp = async (username: string) => {
  const email = `${username}@example.com`;
  const login = await fetchAccounts(
    `/__dev/log-me-in/${encodeURIComponent(email)}?returnTo=%2F`,
    { redirect: "manual" }
  );
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  const created = await fetchAccounts("/api/account", {
    body: JSON.stringify({ username }),
    headers: { "Content-Type": "application/json", cookie },
    method: "POST",
  });
  expect(created.status).toBe(201);
  const { did } = z.object({ did: z.string() }).parse(await created.json());
  return { cookie, did, email, handle: `${username}.minisphere.test` };
};

const createAppPassword = async (
  cookie: string,
  name = "Bluesky",
  privileged = false
) => {
  const response = await fetchAccounts("/api/account/app-passwords", {
    body: JSON.stringify({ name, privileged }),
    headers: { "Content-Type": "application/json", Origin: origin, cookie },
    method: "POST",
  });
  expect(response.status).toBe(201);
  return appPasswordSchema.parse(await response.json());
};

const xrpc = (
  method: string,
  init: { body?: unknown; token?: string; get?: boolean } = {}
) => {
  const headers = new Headers({ Origin: "https://bsky.app" });
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  return fetchAccounts(`/xrpc/com.atproto.server.${method}`, {
    body: init.body === undefined ? null : JSON.stringify(init.body),
    headers,
    method: init.get ? "GET" : "POST",
  });
};

const createSession = async (identifier: string, password: string) => {
  const response = await xrpc("createSession", {
    body: { identifier, password },
  });
  expect(response.status).toBe(200);
  return sessionSchema.parse(await response.json());
};

const expectExpiredToken = async (response: Response) => {
  expect(response.status).toBe(400);
  expect(errorSchema.parse(await response.json()).error).toBe("ExpiredToken");
};

describe("app-password sessions", () => {
  it("shows a generated app password once and lists only its metadata", async () => {
    const { cookie } = await signUp("list-app-passwords");
    const created = await createAppPassword(cookie, "Phone", true);

    const list = await fetchAccounts("/api/account/app-passwords", {
      headers: { cookie },
    });

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toStrictEqual({
      appPasswords: [
        {
          createdAt: created.createdAt,
          id: created.id,
          name: "Phone",
          privileged: true,
        },
      ],
    });
  });

  it("rejects duplicate names and cross-site creation", async () => {
    const { cookie } = await signUp("guard-app-passwords");
    await createAppPassword(cookie, "Phone");

    const duplicate = await fetchAccounts("/api/account/app-passwords", {
      body: JSON.stringify({ name: "Phone", privileged: false }),
      headers: { "Content-Type": "application/json", Origin: origin, cookie },
      method: "POST",
    });
    const crossSite = await fetchAccounts("/api/account/app-passwords", {
      body: JSON.stringify({ name: "Other", privileged: false }),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.test",
        cookie,
      },
      method: "POST",
    });

    expect(duplicate.status).toBe(409);
    expect(crossSite.status).toBe(403);
  });

  it("signs in with a handle, DID, or email and issues PDS-bound tokens", async () => {
    const account = await signUp("session-login");
    const { password } = await createAppPassword(account.cookie);

    const byHandle = await createSession(`@${account.handle}`, password);
    const byDid = await createSession(account.did, password);
    const byEmail = await createSession(account.email.toUpperCase(), password);

    for (const session of [byHandle, byDid, byEmail]) {
      expect(session).toMatchObject({
        did: account.did,
        email: account.email,
        handle: account.handle,
      });
    }
    expect(byHandle.didDoc?.id).toBe(account.did);
    const header = decodeProtectedHeader(byHandle.accessJwt);
    expect(header).toMatchObject({ alg: "ES256K", typ: "at+jwt" });
    expect(decodeJwt(byHandle.accessJwt)).toMatchObject({
      aud: "did:web:pds.test",
      iss: origin,
      scope: "com.atproto.appPass",
      sub: account.did,
    });
    const claims = decodeJwt(byHandle.accessJwt);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBeLessThanOrEqual(300);

    const jwksResponse = await fetchAccounts("/oauth/jwks");
    const jwks = z
      .object({ keys: z.array(z.object({ kid: z.string() })) })
      .parse(await jwksResponse.json());
    expect(jwks.keys.map((key) => key.kid)).toContain(header.kid);
    const [encodedHeader, payload, signature] = byHandle.accessJwt.split(".");
    await expect(
      verifySigWithDidKey(
        header.kid ?? "",
        Uint8Array.from(
          atob((signature ?? "").replaceAll("-", "+").replaceAll("_", "/")),
          (char) => char.codePointAt(0) ?? 0
        ),
        new TextEncoder().encode(`${encodedHeader}.${payload}`)
      )
    ).resolves.toBeTruthy();
  });

  it("marks privileged app-password sessions", async () => {
    const { cookie, did } = await signUp("privileged-session");
    const { password } = await createAppPassword(cookie, "Chat", true);

    const session = await createSession(did, password);

    expect(decodeJwt(session.accessJwt).scope).toBe(
      "com.atproto.appPassPrivileged"
    );
  });

  it("rejects wrong passwords and passwords of another account", async () => {
    const alice = await signUp("wrong-password-alice");
    const bob = await signUp("wrong-password-bob");
    const { password } = await createAppPassword(bob.cookie);

    const responses = await Promise.all(
      [
        [alice.handle, password],
        [bob.handle, "aaaa-aaaa-aaaa-aaaa"],
        ["nobody.minisphere.test", password],
        [`${bob.handle.split(".")[0]}.elsewhere.test`, password],
      ].map(([identifier, attempt]) =>
        xrpc("createSession", { body: { identifier, password: attempt } })
      )
    );

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
    await expect(
      Promise.all(responses.map((response) => response.json()))
    ).resolves.toStrictEqual(
      Array.from({ length: 4 }, () => ({
        error: "AuthenticationRequired",
        message: "Invalid identifier or password",
      }))
    );
  });

  it("reports malformed requests as XRPC errors with CORS", async () => {
    const response = await xrpc("createSession", { body: { identifier: "a" } });

    expect(response.status).toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(response.json()).resolves.toMatchObject({
      error: "InvalidRequest",
    });
  });

  it("reads the session with the access token only", async () => {
    const account = await signUp("get-session");
    const { password } = await createAppPassword(account.cookie);
    const session = await createSession(account.handle, password);

    const current = await xrpc("getSession", {
      get: true,
      token: session.accessJwt,
    });

    expect(current.status).toBe(200);
    const { accessJwt: _a, refreshJwt: _r, ...expected } = session;
    await expect(current.json()).resolves.toStrictEqual(expected);
    await expectExpiredToken(
      await xrpc("getSession", { get: true, token: session.refreshJwt })
    );
  });

  it("rotates refresh tokens and replays the successor during the grace period", async () => {
    const account = await signUp("refresh-session");
    const { password } = await createAppPassword(account.cookie);
    const session = await createSession(account.handle, password);

    const first = await xrpc("refreshSession", { token: session.refreshJwt });
    expect(first.status).toBe(200);
    const rotated = sessionSchema.parse(await first.json());
    const replay = await xrpc("refreshSession", { token: session.refreshJwt });
    expect(replay.status).toBe(200);
    const replayed = sessionSchema.parse(await replay.json());

    expect(rotated.did).toBe(account.did);
    expect(decodeJwt(rotated.refreshJwt).jti).not.toBe(
      decodeJwt(session.refreshJwt).jti
    );
    expect(decodeJwt(replayed.refreshJwt).jti).toBe(
      decodeJwt(rotated.refreshJwt).jti
    );
    await expectExpiredToken(
      await xrpc("refreshSession", { token: session.accessJwt })
    );
  });

  it("ends sessions on logout and on app-password revocation", async () => {
    const account = await signUp("end-session");
    const appPassword = await createAppPassword(account.cookie);
    const loggedOut = await createSession(account.handle, appPassword.password);
    const revoked = await createSession(account.handle, appPassword.password);

    const logout = await xrpc("deleteSession", { token: loggedOut.refreshJwt });
    expect(logout.status).toBe(200);
    await expectExpiredToken(
      await xrpc("refreshSession", { token: loggedOut.refreshJwt })
    );

    const revoke = await fetchAccounts(
      `/api/account/app-passwords/${appPassword.id}`,
      { headers: { Origin: origin, cookie: account.cookie }, method: "DELETE" }
    );
    expect(revoke.status).toBe(204);
    await expectExpiredToken(
      await xrpc("refreshSession", { token: revoked.refreshJwt })
    );
    const again = await xrpc("createSession", {
      body: { identifier: account.handle, password: appPassword.password },
    });
    expect(again.status).toBe(401);
  });
});
