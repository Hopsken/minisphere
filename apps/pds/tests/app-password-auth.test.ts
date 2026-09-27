/* oxlint-disable vitest/max-expects -- Each case asserts one protocol boundary response. */
import { describe, expect, it } from "vitest";

import {
  createHostedAccount,
  ORIGIN,
  signAppPasswordToken,
  xrpc,
} from "./app-password-session";

const createRecord = (repo: string, token: string, collection: string) =>
  xrpc("com.atproto.repo.createRecord", {
    body: JSON.stringify({
      collection,
      record: { $type: collection, text: "from a password client" },
      repo,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    token,
  });

// Failure cases: an OAuth token or a token for another audience is accepted as
// a Bearer credential, token lifetimes are not bounded, a foreign key or an
// unhosted account passes, or a session token bypasses DPoP when sent as DPoP.
describe("app-password Bearer tokens", () => {
  it("write any collection and upload blobs", async () => {
    const { did } = await createHostedAccount();
    const token = await signAppPasswordToken(did);

    const post = await createRecord(did, token, "app.example.item");
    const blob = await xrpc("com.atproto.repo.uploadBlob", {
      body: new Uint8Array([1, 2, 3]),
      headers: { "Content-Type": "image/png" },
      method: "POST",
      token,
    });

    expect(post.status).toBe(200);
    expect(blob.status).toBe(200);
  });

  it("cannot write another account's repository", async () => {
    const alice = await createHostedAccount();
    const bob = await createHostedAccount();

    const response = await createRecord(
      bob.did,
      await signAppPasswordToken(alice.did),
      "app.example.item"
    );

    expect(response.status).toBe(403);
  });

  it.each([
    ["an OAuth audience", () => ({ aud: ORIGIN })],
    ["another issuer", () => ({ iss: "https://other.test" })],
    ["an unknown scope", () => ({ scope: "com.atproto.access" })],
    ["a DPoP binding", () => ({ cnf: { jkt: "thumbprint" } })],
    ["an expired lifetime", (now: number) => ({ exp: now - 1, iat: now - 60 })],
    [
      "a lifetime above five minutes",
      (now: number) => ({ exp: now + 3600, iat: now }),
    ],
  ])("rejects a token with %s", async (_name, overrides) => {
    const { did } = await createHostedAccount();

    const response = await createRecord(
      did,
      await signAppPasswordToken(did, overrides),
      "app.example.item"
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_token",
    });
  });

  it("rejects foreign signatures and accounts hosted elsewhere", async () => {
    const hosted = await createHostedAccount();
    const unhosted = await createHostedAccount(false);

    const forged = await createRecord(
      hosted.did,
      await signAppPasswordToken(hosted.did, undefined, true),
      "app.example.item"
    );
    const elsewhere = await createRecord(
      unhosted.did,
      await signAppPasswordToken(unhosted.did),
      "app.example.item"
    );

    expect(forged.status).toBe(401);
    expect(elsewhere.status).toBe(401);
  });

  it("does not accept a session token as a DPoP token", async () => {
    const { did } = await createHostedAccount();
    const token = await signAppPasswordToken(did);

    const response = await xrpc("com.atproto.repo.createRecord", {
      body: JSON.stringify({
        collection: "app.example.item",
        record: { text: "x" },
        repo: did,
      }),
      headers: {
        Authorization: `DPoP ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(401);
  });
});

describe("session methods", () => {
  it.each([
    ["createSession", "POST"],
    ["refreshSession", "POST"],
    ["getSession", "GET"],
  ])("forwards %s to Accounts unchanged", async (method, httpMethod) => {
    const body =
      httpMethod === "POST" ? JSON.stringify({ identifier: "a" }) : null;

    const response = await xrpc(`com.atproto.server.${method}`, {
      body,
      headers: {
        Authorization: "Bearer session-token",
        "Content-Type": "application/json",
        Cookie: "private=1",
      },
      method: httpMethod,
    });

    expect(response.status).toBe(method === "refreshSession" ? 400 : 200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toStrictEqual({
      authorization: "Bearer session-token",
      body,
      contentType: "application/json",
      cookie: null,
      method: httpMethod,
      path: `/xrpc/com.atproto.server.${method}`,
    });
  });

  it("relays an empty deleteSession response without a content type", async () => {
    const response = await xrpc("com.atproto.server.deleteSession", {
      headers: { Authorization: "Bearer refresh-token" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBeNull();
    await expect(response.text()).resolves.toBe("");
  });
});
