import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const origin = "https://accounts.test";
const accountSchema = z.discriminatedUnion("state", [
  z.object({ handleDomain: z.string(), state: z.literal("needs_username") }),
  z.object({
    handle: z.string(),
    handleDomain: z.string(),
    state: z.literal("provisioning"),
    username: z.string(),
  }),
  z.object({
    did: z.string(),
    handle: z.string(),
    handleDomain: z.string(),
    state: z.literal("active"),
    username: z.string(),
  }),
]);

const login = async (email: string) => {
  const response = await exports.default.fetch(
    new Request(
      `${origin}/__dev/log-me-in/${encodeURIComponent(email)}?returnTo=%2F`,
      { redirect: "manual" }
    )
  );
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
};

const accountRequest = (cookie: string, init?: RequestInit) =>
  exports.default.fetch(
    new Request(`${origin}/api/account`, {
      ...init,
      headers: { ...init?.headers, cookie },
    })
  );

const createAccount = (cookie: string, username: string) =>
  accountRequest(cookie, {
    body: JSON.stringify({ username }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

describe("Entryway account API", () => {
  it("gates a new authenticated user on username completion", async () => {
    const cookie = await login("new-entryway-user@example.com");
    const response = await accountRequest(cookie);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      handleDomain: "r2d2.party",
      state: "needs_username",
    });
  });

  it("atomically activates one username and DID for the current user", async () => {
    const cookie = await login("active-entryway-user@example.com");
    const first = await createAccount(cookie, "Alice-Entryway");
    const account = accountSchema.parse(await first.json());

    expect(first.status).toBe(201);
    expect(account).toStrictEqual({
      did: expect.stringMatching(/^did:plc:[a-z2-7]{24}$/u),
      handle: "alice-entryway.r2d2.party",
      handleDomain: "r2d2.party",
      state: "active",
      username: "alice-entryway",
    });

    const second = await createAccount(cookie, "alice-entryway");
    expect({ body: await second.json(), status: second.status }).toStrictEqual({
      body: account,
      status: 201,
    });

    const row = await env.DB.prepare(
      "SELECT username, did, status FROM atproto_account WHERE username = ?"
    )
      .bind("alice-entryway")
      .first();
    expect(row).toStrictEqual({
      did: account.state === "active" ? account.did : null,
      status: "active",
      username: "alice-entryway",
    });
  });

  it("keeps an unknown outcome on the same expected DID", async () => {
    const cookie = await login("waiting-entryway-user@example.com");
    const first = await createAccount(cookie, "waiting");
    const firstBody = accountSchema.parse(await first.json());
    const identity = await env.DB.prepare(
      "SELECT did, signing_key FROM atproto_account WHERE username = ?"
    )
      .bind("waiting")
      .first<{ did: string; signing_key: string }>();

    const retry = await createAccount(cookie, "waiting");
    const retriedIdentity = await env.DB.prepare(
      "SELECT did, signing_key FROM atproto_account WHERE username = ?"
    )
      .bind("waiting")
      .first<{ did: string; signing_key: string }>();

    expect({ body: firstBody, status: first.status }).toStrictEqual({
      body: {
        handle: "waiting.r2d2.party",
        handleDomain: "r2d2.party",
        state: "provisioning",
        username: "waiting",
      },
      status: 202,
    });
    expect(retry.status).toBe(202);
    expect(identity).toStrictEqual({
      did: expect.stringMatching(/^did:plc:[a-z2-7]{24}$/u),
      signing_key: expect.stringMatching(/^did:key:/u),
    });
    expect(retriedIdentity).toStrictEqual(identity);
    await expect(
      exports.AccountsEntrypoint.resolveHandle("waiting.r2d2.party")
    ).resolves.toBeNull();
  });

  it("recovers a timed-out response by verifying PDS and PLC state", async () => {
    const cookie = await login("recovered-entryway-user@example.com");
    const response = await createAccount(cookie, "recovered");
    const account = accountSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(account).toMatchObject({
      did: expect.stringMatching(/^did:plc:[a-z2-7]{24}$/u),
      state: "active",
      username: "recovered",
    });
  });

  it("does not activate from a successful PDS response without PLC state", async () => {
    const cookie = await login("pds-only-entryway-user@example.com");
    const response = await createAccount(cookie, "pds-only");
    const account = accountSchema.parse(await response.json());
    const retry = await createAccount(cookie, "pds-only");
    const retryAccount = accountSchema.parse(await retry.json());

    expect({ account, status: response.status }).toStrictEqual({
      account: {
        handle: "pds-only.r2d2.party",
        handleDomain: "r2d2.party",
        state: "provisioning",
        username: "pds-only",
      },
      status: 202,
    });
    expect({ account: retryAccount, status: retry.status }).toStrictEqual({
      account,
      status: 202,
    });
    await expect(
      exports.AccountsEntrypoint.resolveHandle("pds-only.r2d2.party")
    ).resolves.toBeNull();
  });

  it("releases a username after a confirmed failure", async () => {
    const cookie = await login("failed-entryway-user@example.com");
    const response = await createAccount(cookie, "unavailable");

    expect(response.status).toBe(502);
    await expect(
      env.DB.prepare("SELECT username FROM atproto_account WHERE username = ?")
        .bind("unavailable")
        .first()
    ).resolves.toBeNull();
  });

  it("allows only one user to claim a username", async () => {
    const [firstCookie, secondCookie] = await Promise.all([
      login("username-winner@example.com"),
      login("username-loser@example.com"),
    ]);
    const [first, second] = await Promise.all([
      createAccount(firstCookie, "one-winner"),
      createAccount(secondCookie, "one-winner"),
    ]);

    expect([first.status, second.status].toSorted()).toStrictEqual([201, 409]);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM atproto_account WHERE username = ?"
    )
      .bind("one-winner")
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});
