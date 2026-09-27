/* oxlint-disable vitest/max-expects -- Proxy cases assert the forwarded request and the relayed response together. */
import { verifySigWithDidKey } from "@atcute/crypto";
import { base64url, decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createHostedAccount,
  signAppPasswordToken,
  xrpc,
} from "./app-password-session";

const echoSchema = z.object({
  body: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
  method: z.string(),
  url: z.string(),
});

const privileged = () => ({ scope: "com.atproto.appPassPrivileged" });

/** Verifies a service JWT against the account's repository key. */
const verifyServiceJwt = async (token: string, repoKeyDid: string) => {
  const [header, payload, signature] = token.split(".");
  await expect(
    verifySigWithDidKey(
      repoKeyDid,
      new Uint8Array(base64url.decode(signature ?? "")),
      new Uint8Array(new TextEncoder().encode(`${header}.${payload}`))
    )
  ).resolves.toBeTruthy();
  return decodeJwt(token);
};

// Failure cases: client credentials or cookies leak upstream, the service JWT
// is signed by the wrong key or names the wrong audience or method, upstream
// errors turn into PDS errors, chat is reachable without a privileged app
// password, account management is proxied, or unknown methods require auth.
describe("service proxying", () => {
  it("sends app.bsky methods to the Bluesky AppView as the account", async () => {
    const { did, repoKeyDid } = await createHostedAccount();

    const response = await xrpc("app.bsky.feed.getTimeline", {
      headers: {
        "Accept-Language": "zh-CN",
        Cookie: "session=secret",
        "atproto-accept-labelers": "did:plc:labeler;redact",
        "x-atproto-client": "bluesky",
      },
      query: { limit: "5" },
      token: await signAppPasswordToken(did),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("atproto-content-labelers")).toBe(
      "did:plc:labeler"
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    const echo = echoSchema.parse(await response.json());
    expect(echo.url).toBe(
      "https://api.bsky.app/xrpc/app.bsky.feed.getTimeline?limit=5"
    );
    // The Workers runtime adds `cf-worker` to every outbound request.
    const { authorization, "cf-worker": _runtime, ...forwarded } = echo.headers;
    expect(forwarded).toStrictEqual({
      "accept-language": "zh-CN",
      "atproto-accept-labelers": "did:plc:labeler;redact",
      "x-atproto-client": "bluesky",
    });
    const claims = await verifyServiceJwt(
      authorization?.replace(/^Bearer /u, "") ?? "",
      repoKeyDid
    );
    expect(claims).toMatchObject({
      aud: "did:web:api.bsky.app",
      iss: did,
      lxm: "app.bsky.feed.getTimeline",
    });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(60);
  });

  it("follows atproto-proxy, forwards POST bodies, and relays upstream errors", async () => {
    const { did } = await createHostedAccount();
    const token = await signAppPasswordToken(did);

    const post = await xrpc("app.bsky.notification.registerPush", {
      body: JSON.stringify({ token: "push" }),
      headers: {
        "Content-Type": "application/json",
        "atproto-proxy": "did:web:appview.test#bsky_appview",
      },
      method: "POST",
      token,
    });
    const failed = await xrpc("com.example.method.fail", {
      headers: { "atproto-proxy": "did:web:appview.test#bsky_appview" },
      token,
    });

    expect(post.status).toBe(200);
    const echo = echoSchema.parse(await post.json());
    expect(echo).toMatchObject({
      body: JSON.stringify({ token: "push" }),
      method: "POST",
      url: "https://appview.test/xrpc/app.bsky.notification.registerPush",
    });
    expect(echo.headers["content-type"]).toBe("application/json");
    expect(
      decodeJwt(echo.headers.authorization?.replace(/^Bearer /u, "") ?? "").aud
    ).toBe("did:web:appview.test");
    expect(failed.status).toBe(418);
  });

  it("allows chat only for privileged app passwords", async () => {
    const { did } = await createHostedAccount();

    const standard = await xrpc("chat.bsky.convo.listConvos", {
      token: await signAppPasswordToken(did),
    });
    const allowed = await xrpc("chat.bsky.convo.listConvos", {
      token: await signAppPasswordToken(did, privileged),
    });

    expect(standard.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(echoSchema.parse(await allowed.json()).url).toBe(
      "https://api.bsky.chat/xrpc/chat.bsky.convo.listConvos"
    );
  });

  it.each([
    ["an account-management method", "com.atproto.server.createAppPassword"],
    ["an insecure service endpoint", "app.bsky.feed.getTimeline"],
  ])("refuses %s", async (_name, method) => {
    const { did } = await createHostedAccount();

    const response = await xrpc(method, {
      headers: {
        "atproto-proxy": method.startsWith("app.")
          ? "did:web:appview.test#insecure"
          : "did:web:appview.test#bsky_appview",
      },
      token: await signAppPasswordToken(did),
    });

    expect(response.status).toBe(400);
  });

  it("requires a session, and reports unknown methods without one", async () => {
    const unauthenticated = await xrpc("app.bsky.feed.getTimeline");
    const unknown = await xrpc("com.example.unknown.method");

    expect(unauthenticated.status).toBe(401);
    expect(unknown.status).toBe(501);
  });
});

interface ServiceAuthRequest {
  exp?: number;
  lxm?: string;
}

const serviceAuthRejections: [string, ServiceAuthRequest, number][] = [
  ["a past expiry", { exp: -10, lxm: "app.bsky.feed.getTimeline" }, 400],
  [
    "an expiry beyond an hour",
    { exp: 2 * 60 * 60, lxm: "app.bsky.feed.getTimeline" },
    400,
  ],
  ["a long method-less token", { exp: 5 * 60 }, 400],
  ["a protected method", { lxm: "com.atproto.server.createAccount" }, 400],
  ["chat without privilege", { lxm: "chat.bsky.convo.listConvos" }, 403],
];

describe("com.atproto.server.getServiceAuth", () => {
  it("signs a token for the requested audience, method, and expiry", async () => {
    const { did, repoKeyDid } = await createHostedAccount();
    const exp = Math.floor(Date.now() / 1000) + 30 * 60;

    const response = await xrpc("com.atproto.server.getServiceAuth", {
      query: {
        aud: "did:web:video.test",
        exp: String(exp),
        lxm: "com.atproto.repo.uploadBlob",
      },
      token: await signAppPasswordToken(did),
    });

    expect(response.status).toBe(200);
    const { token } = z
      .object({ token: z.string() })
      .parse(await response.json());
    await expect(verifyServiceJwt(token, repoKeyDid)).resolves.toMatchObject({
      aud: "did:web:video.test",
      exp,
      iss: did,
      lxm: "com.atproto.repo.uploadBlob",
    });
  });

  it.each(serviceAuthRejections)(
    "rejects %s",
    async (_name, { exp, lxm }, status) => {
      const { did } = await createHostedAccount();
      const query = new URLSearchParams({ aud: "did:web:video.test" });
      if (exp !== undefined) {
        query.set("exp", String(Math.floor(Date.now() / 1000) + exp));
      }
      if (lxm !== undefined) {
        query.set("lxm", lxm);
      }

      const response = await xrpc("com.atproto.server.getServiceAuth", {
        query,
        token: await signAppPasswordToken(did),
      });

      expect(response.status).toBe(status);
    }
  );
});
