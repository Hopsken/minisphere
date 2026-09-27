/* oxlint-disable vitest/max-expects, eslint/no-await-in-loop -- Birth date flows assert writes by reading them back, in order. */
/* oxlint-disable unicorn/no-await-expression-member -- Keep each response assertion next to its request. */
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const origin = "https://minisphere.test";

const fetchAccounts = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`${origin}${path}`, init));

const signUp = async (username: string) => {
  const login = await fetchAccounts(
    `/__dev/log-me-in/${username}%40example.com?returnTo=%2F`,
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
  return { cookie, did };
};

const getBirthDate = (cookie: string) =>
  fetchAccounts("/api/account/birth-date", { headers: { cookie } });

const putBirthDate = (cookie: string, birthDate: string, from = origin) =>
  fetchAccounts("/api/account/birth-date", {
    body: JSON.stringify({ birthDate }),
    headers: { "Content-Type": "application/json", Origin: from, cookie },
    method: "PUT",
  });

// Failure cases: a birth date is saved for another user's account, a
// cross-site or impossible date is saved, or a user without an account writes.
describe("Birth date", () => {
  it("is saved on the PDS for the user's own account", async () => {
    const alice = await signUp("birthday-alice");
    const bob = await signUp("birthday-bob");

    await expect(
      (await getBirthDate(alice.cookie)).json()
    ).resolves.toStrictEqual({ birthDate: null });
    expect((await putBirthDate(alice.cookie, "2000-02-29")).status).toBe(200);
    const changed = await putBirthDate(alice.cookie, "2001-03-01");
    expect(changed.status).toBe(200);
    await expect(changed.json()).resolves.toStrictEqual({
      birthDate: "2001-03-01",
    });

    await expect(
      (await getBirthDate(alice.cookie)).json()
    ).resolves.toStrictEqual({ birthDate: "2001-03-01" });
    await expect(
      (await getBirthDate(bob.cookie)).json()
    ).resolves.toStrictEqual({
      birthDate: null,
    });
    await expect(env.PDS.getBirthDate(alice.did)).resolves.toBe("2001-03-01");
    await expect(env.PDS.getBirthDate(bob.did)).resolves.toBeNull();
  });

  it("needs a finished account", async () => {
    const login = await fetchAccounts(
      "/__dev/log-me-in/birthday-dave%40example.com?returnTo=%2F",
      { redirect: "manual" }
    );
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";

    expect((await getBirthDate(cookie)).status).toBe(409);
    expect((await putBirthDate(cookie, "2000-01-01")).status).toBe(409);
  });

  it("rejects invalid dates and cross-site writes", async () => {
    const { cookie } = await signUp("birthday-carol");
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    for (const birthDate of [
      "2001-02-29",
      "2000-01-01T00:00:00.000Z",
      "1899-12-31",
      tomorrow,
    ]) {
      expect((await putBirthDate(cookie, birthDate)).status).toBe(400);
    }
    expect(
      (await putBirthDate(cookie, "2000-01-01", "https://evil.test")).status
    ).toBe(403);

    await expect((await getBirthDate(cookie)).json()).resolves.toStrictEqual({
      birthDate: null,
    });
  });

  it("requires a session", async () => {
    expect((await fetchAccounts("/api/account/birth-date")).status).toBe(401);
  });
});
