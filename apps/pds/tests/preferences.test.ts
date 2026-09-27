/* oxlint-disable vitest/max-expects, eslint/no-await-in-loop -- Preference flows assert writes by reading them back, in order. */
/* oxlint-disable unicorn/no-await-expression-member -- Keep each response assertion next to its request. */
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  createHostedAccount,
  signAppPasswordToken,
  xrpc,
} from "./app-password-session";

const getPreferences = (token: string, headers: HeadersInit = {}) =>
  xrpc("app.bsky.actor.getPreferences", { headers, token });

const putPreferences = (
  token: string,
  preferences: object[],
  headers: Record<string, string> = {}
) =>
  xrpc("app.bsky.actor.putPreferences", {
    body: JSON.stringify({ preferences }),
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST",
    token,
  });

const adultContent = {
  $type: "app.bsky.actor.defs#adultContentPref",
  enabled: false,
};
const savedFeeds = {
  $type: "app.bsky.actor.defs#savedFeedsPrefV2",
  items: [{ id: "3l", pinned: true, type: "timeline", value: "following" }],
};

const session = async (birthDate?: string) => {
  const { did } = await createHostedAccount();
  if (birthDate) {
    await exports.PdsControlPlane.setBirthDate(did, birthDate);
  }
  return signAppPasswordToken(did);
};

/** The UTC date `years` years and `days` days before today. */
const dateBefore = (years: number, days = 0) => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

const declaredAgePref = (
  over13: boolean,
  over16: boolean,
  over18: boolean
) => ({
  $type: "app.bsky.actor.defs#declaredAgePref",
  isOverAge13: over13,
  isOverAge16: over16,
  isOverAge18: over18,
});

// Failure cases: preferences leak between accounts, a write merges instead of
// replacing, a session writes personal details or the derived age, a foreign
// namespace is stored, or a request for another AppView is answered locally.
describe("Bluesky preferences", () => {
  it("start empty and are replaced by each write", async () => {
    const token = await session();
    const other = await session();

    const initial = await getPreferences(token);
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toStrictEqual({ preferences: [] });

    const unknownPreference = { $type: "app.bsky.example#futurePref", on: 1 };
    expect(
      (await putPreferences(token, [adultContent, unknownPreference])).status
    ).toBe(200);
    expect((await putPreferences(token, [savedFeeds])).status).toBe(200);

    await expect((await getPreferences(token)).json()).resolves.toStrictEqual({
      preferences: [savedFeeds],
    });
    await expect((await getPreferences(other)).json()).resolves.toStrictEqual({
      preferences: [],
    });
  });

  it("drops the derived age and refuses personal details or other namespaces", async () => {
    const token = await session();
    await putPreferences(token, [adultContent]);

    const declaredAge = await putPreferences(token, [
      savedFeeds,
      {
        $type: "app.bsky.actor.defs#declaredAgePref",
        isOverAge13: true,
        isOverAge16: true,
        isOverAge18: true,
      },
    ]);
    expect(declaredAge.status).toBe(200);
    for (const preference of [
      {
        $type: "app.bsky.actor.defs#personalDetailsPref",
        birthDate: "2000-01-01T00:00:00.000Z",
      },
      { $type: "com.example.pref", on: true },
    ]) {
      expect((await putPreferences(token, [preference])).status).toBe(400);
    }

    await expect((await getPreferences(token)).json()).resolves.toStrictEqual({
      preferences: [savedFeeds],
    });
  });

  it("keeps Bluesky AppView preferences local and proxies other AppViews", async () => {
    const token = await session();
    await putPreferences(token, [adultContent], {
      "atproto-proxy": "did:web:api.bsky.app#bsky_appview",
    });

    const local = await getPreferences(token, {
      "atproto-proxy": "did:web:api.bsky.app#bsky_appview",
    });
    const proxied = await getPreferences(token, {
      "atproto-proxy": "did:web:appview.test#bsky_appview",
    });

    await expect(local.json()).resolves.toStrictEqual({
      preferences: [adultContent],
    });
    expect(proxied.status).toBe(200);
    await expect(proxied.json()).resolves.toMatchObject({
      url: "https://appview.test/xrpc/app.bsky.actor.getPreferences",
    });
  });

  // Failure cases: an age counted from the wrong day, a client write that
  // replaces the birth date or the derived age, or the birth date returned.
  it("derive the declared age from the birth date that Accounts sets", async () => {
    for (const [birthDate, expected] of [
      [dateBefore(18), declaredAgePref(true, true, true)],
      [dateBefore(18, -1), declaredAgePref(true, true, false)],
      [dateBefore(16, -1), declaredAgePref(true, false, false)],
      [dateBefore(13, -1), declaredAgePref(false, false, false)],
    ] as const) {
      const token = await session(birthDate);
      await putPreferences(token, [
        adultContent,
        declaredAgePref(false, false, false),
      ]);

      await expect((await getPreferences(token)).json()).resolves.toStrictEqual(
        { preferences: [adultContent, expected] }
      );
    }
  });

  it("keep the stored preferences when Accounts changes the birth date", async () => {
    const { did } = await createHostedAccount();
    const token = await signAppPasswordToken(did);
    await expect(exports.PdsControlPlane.getBirthDate(did)).resolves.toBeNull();
    await putPreferences(token, [savedFeeds]);

    await exports.PdsControlPlane.setBirthDate(did, dateBefore(20));
    await exports.PdsControlPlane.setBirthDate(did, dateBefore(14));

    await expect(exports.PdsControlPlane.getBirthDate(did)).resolves.toBe(
      dateBefore(14)
    );
    await expect((await getPreferences(token)).json()).resolves.toStrictEqual({
      preferences: [savedFeeds, declaredAgePref(true, false, false)],
    });
  });

  it("requires a session", async () => {
    expect((await xrpc("app.bsky.actor.getPreferences")).status).toBe(401);
  });
});
