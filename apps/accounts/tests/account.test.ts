import { isSignedOperationValid } from "@atcute/did-plc";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createDatabase } from "../worker/db";
import { restorePlcAccountMaterial } from "../worker/lib/plc-account";
import { UserRepository } from "../worker/repositories/user-repository";
import { UsernameUnavailableError } from "../worker/repositories/username-unavailable-error";

const origin = "https://minisphere.test";
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

const usernameAvailability = (cookie: string, username: string) =>
  exports.default.fetch(
    new Request(
      `${origin}/api/account/usernames/${encodeURIComponent(username)}`,
      { headers: { cookie } }
    )
  );

describe("Entryway account API", () => {
  it("gates a new authenticated user on username completion", async () => {
    const cookie = await login("new-entryway-user@example.com");
    const response = await accountRequest(cookie);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      handleDomain: "minisphere.test",
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
      handle: "alice-entryway.minisphere.test",
      handleDomain: "minisphere.test",
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

  it("uses the same saved signed operation for concurrent HTTP requests", async () => {
    const cookie = await login("same-user-race@example.com");
    const [first, second] = await Promise.all([
      createAccount(cookie, "same-user-race"),
      createAccount(cookie, "same-user-race"),
    ]);
    const firstBody = await first.json();
    expect([first.status, second.status]).toStrictEqual([201, 201]);
    await expect(second.json()).resolves.toStrictEqual(firstBody);
    const user = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
      .bind("same-user-race@example.com")
      .first<{ id: string }>();
    if (!user) {
      throw new Error("Missing test user");
    }
    const stored = await new UserRepository(
      createDatabase(env.DB)
    ).findAccountByUserId(user.id);
    if (!stored) {
      throw new Error("Missing stored identity");
    }
    const material = await restorePlcAccountMaterial(
      user.id,
      env.ACCOUNTS_ENCRYPTION_KEY,
      stored
    );
    await expect(
      isSignedOperationValid(
        material.operation.rotationKeys,
        material.operation
      )
    ).resolves.toBe(material.operation.rotationKeys[0]);
    const response = await fetch(
      new Request(`${env.PLC_DIRECTORY}/${material.did}/data`)
    );
    const { sig: _sig, ...expectedState } = material.operation;
    await expect(response.json()).resolves.toStrictEqual({
      ...expectedState,
      did: material.did,
    });
    expect(firstBody).toMatchObject({ did: material.did, state: "active" });
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
        handle: "waiting.minisphere.test",
        handleDomain: "minisphere.test",
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
    const resolution = await exports.default.fetch(
      new Request("https://waiting.minisphere.test/.well-known/atproto-did")
    );
    expect(resolution.status).toBe(404);
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
        handle: "pds-only.minisphere.test",
        handleDomain: "minisphere.test",
        state: "provisioning",
        username: "pds-only",
      },
      status: 202,
    });
    expect({ account: retryAccount, status: retry.status }).toStrictEqual({
      account,
      status: 202,
    });
    const resolution = await exports.default.fetch(
      new Request("https://pds-only.minisphere.test/.well-known/atproto-did")
    );
    expect(resolution.status).toBe(404);
  });

  it("retains identity material after a response failure for safe concurrent retry", async () => {
    const cookie = await login("failed-entryway-user@example.com");
    const response = await createAccount(cookie, "unavailable");

    expect(response.status).toBe(502);
    await expect(
      env.DB.prepare("SELECT username FROM atproto_account WHERE username = ?")
        .bind("unavailable")
        .first()
    ).resolves.toStrictEqual({ username: "unavailable" });
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

  it("throws when a reserved name is passed directly to the repository", async () => {
    const users = new UserRepository(createDatabase(env.DB));
    await expect(
      users.reserveAccount("reserved-user", " PDS ")
    ).rejects.toThrow(UsernameUnavailableError);
    await expect(
      users.findAccountByUserId("reserved-user")
    ).resolves.toBeUndefined();
  });

  it("rejects reserved usernames without persisting account state", async () => {
    const reservedVariants = [
      " PDS ",
      "AdMiN",
      " API ",
      " WebMaster ",
      " CDN ",
      " Managed-Accounts ",
      " ToWn ",
    ];

    await Promise.all(
      reservedVariants.map(async (username, index) => {
        const cookie = await login(`reserved-username-${index}@example.com`);
        const availability = await usernameAvailability(cookie, username);
        const registration = await createAccount(cookie, username);

        expect({
          availability: await availability.json(),
          availabilityStatus: availability.status,
          registration: await registration.json(),
          registrationStatus: registration.status,
        }).toStrictEqual({
          availability: {
            available: false,
            handle: `${username.trim().toLowerCase()}.minisphere.test`,
            username: username.trim().toLowerCase(),
          },
          availabilityStatus: 200,
          registration: {
            message: "Username is not available",
            status: 409,
          },
          registrationStatus: 409,
        });
      })
    );

    const persisted = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM atproto_account WHERE username IN (?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        "pds",
        "admin",
        "api",
        "webmaster",
        "cdn",
        "managed-accounts",
        "town"
      )
      .first<{ count: number }>();
    expect(persisted?.count).toBe(0);
  });

  it("allows non-exact matches to reserved usernames", async () => {
    const cookie = await login("pds-user@example.com");
    const availability = await usernameAvailability(cookie, " PDS-user ");
    const registration = await createAccount(cookie, " PDS-user ");

    await expect(availability.json()).resolves.toStrictEqual({
      available: true,
      handle: "pds-user.minisphere.test",
      username: "pds-user",
    });
    expect(availability.status).toBe(200);
    expect(registration.status).toBe(201);
    await expect(registration.json()).resolves.toMatchObject({
      handle: "pds-user.minisphere.test",
      state: "active",
      username: "pds-user",
    });
  });
});
