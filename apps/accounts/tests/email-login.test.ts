/* oxlint-disable vitest/max-expects, eslint/no-await-in-loop -- Integration flows verify ordered requests and their persisted effects. */
/* oxlint-disable vitest/expect-expect -- expectStatus asserts each HTTP response. */
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { isEmailAllowed } from "../worker/lib/email-allowlist";

interface LoginRequest {
  email: string;
  otp?: string;
  type?: string;
}
const post = (path: string, body: LoginRequest, ip = "192.0.2.1") =>
  exports.default.fetch(
    new Request(`https://accounts.test/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        Origin: "https://accounts.test",
        "cf-connecting-ip": ip,
      },
      method: "POST",
    })
  );
const send = (email: string, ip?: string) =>
  post("/email-otp/send-verification-otp", { email, type: "sign-in" }, ip);
const signIn = (email: string, otp: string) =>
  post("/sign-in/email-otp", { email, otp });
const expectStatus = async (request: Promise<Response>, status: number) => {
  const response = await request;
  expect(response.status).toBe(status);
  return response;
};
const readCode = async (email: string) => {
  const response = await fetch(
    `https://api.resend.com/__test/email?email=${encodeURIComponent(email)}`
  );
  const message = z
    .object({ from: z.string(), text: z.string(), to: z.array(z.string()) })
    .parse(await response.json());
  expect(message).toMatchObject({
    from: "Minisphere <login@example.com>",
    to: [email],
  });
  expect(message.text).toContain("10 minutes");
  const code = /code is (?<code>\d{6})/u.exec(message.text)?.groups?.code;
  if (!code) {
    throw new Error("Missing code in test email");
  }
  return code;
};
const expireCooldown = (email: string) =>
  env.DB.prepare("UPDATE verification SET expires_at = 0 WHERE identifier = ?")
    .bind(`email-login-cooldown:${email}`)
    .run();

describe("email allowlist", () => {
  it.each([
    ["any@else.test", "*", true],
    [" MEMBER@X.COM ", " x.com, e@e.com ", true],
    ["e@e.com", "x.com,e@e.com", true],
    ["other@e.com", "x.com,e@e.com", false],
    ["user@sub.x.com", "x.com", false],
    ["user@notx.com", "x.com", false],
    ["e+tag@e.com", "e@e.com", false],
    ["first.last@x.com", "firstlast@x.com", false],
    ["user@x.com", " , ", false],
  ])("matches %s against %s", (email, allowlist, expected) => {
    expect(isEmailAllowed(email, allowlist)).toBe(expected);
  });
});

describe("email login", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM rate_limit").run();
  });

  it("stores a ten-minute code hash, creates a verified user, and consumes the code once", async () => {
    const email = "new-member@example.com";
    await expectStatus(send(" New-Member@EXAMPLE.COM "), 200);
    const code = await readCode(email);
    const stored = await env.DB.prepare(
      "SELECT value, expires_at, created_at FROM verification WHERE identifier = ?"
    )
      .bind(`sign-in-otp-${email}`)
      .first<{ value: string; expires_at: number; created_at: number }>();
    if (!stored) {
      throw new Error("Missing verification record");
    }
    expect(stored.value).not.toContain(code);
    expect(stored.expires_at - stored.created_at).toBeGreaterThanOrEqual(
      599_000
    );
    expect(stored.expires_at - stored.created_at).toBeLessThanOrEqual(600_000);
    await expect(
      env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first()
    ).resolves.toBeNull();
    const response = await expectStatus(signIn(email, code), 200);
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    expect(cookie).toContain("session_token=");
    const session = await exports.default.fetch(
      new Request("https://accounts.test/api/auth/get-session", {
        headers: { cookie },
      })
    );
    await expect(session.json()).resolves.toMatchObject({
      user: { email, emailVerified: true },
    });
    await expectStatus(signIn(email, code), 400);
    await expireCooldown(email);
    await expectStatus(send(email), 200);
    await expectStatus(signIn(email, await readCode(email)), 200);
    const users = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
      .bind(email)
      .all();
    expect(users.results).toHaveLength(1);
  });

  it("checks eligibility on sending and sign-in and disables other OTP purposes", async () => {
    await expectStatus(send("blocked@outside.test"), 403);
    await expectStatus(signIn("blocked@outside.test", "123456"), 403);
    await expectStatus(send("member@other.test"), 200);
    await expectStatus(send("another@other.test"), 403);
    await expectStatus(send("invalid-address"), 400);
    await expectStatus(
      post("/email-otp/send-verification-otp", {
        email: "member@example.com",
        type: "email-verification",
      }),
      403
    );
    await expectStatus(
      post("/email-otp/change-email", {
        email: "member@example.com",
        otp: "123456",
      }),
      404
    );
  });

  it("enforces the cooldown across IPs and replaces the previous verification record", async () => {
    const email = "resend@example.com";
    await expectStatus(send(email), 200);
    const old = await env.DB.prepare(
      "SELECT id FROM verification WHERE identifier = ?"
    )
      .bind(`sign-in-otp-${email}`)
      .first<{ id: string }>();
    if (!old) {
      throw new Error("Missing original verification");
    }
    await expectStatus(send(email, "192.0.2.2"), 429);
    await expireCooldown(email);
    await expectStatus(send(email), 200);
    const records = await env.DB.prepare(
      "SELECT id FROM verification WHERE identifier = ?"
    )
      .bind(`sign-in-otp-${email}`)
      .all<{ id: string }>();
    expect(records.results).toHaveLength(1);
    expect(records.results[0]?.id).not.toBe(old.id);
    await expectStatus(signIn(email, await readCode(email)), 200);
  });

  it("allows only one concurrent send for the same email", async () => {
    const email = "concurrent@example.com";
    const responses = await Promise.all([
      send(email, "192.0.2.40"),
      send(" CONCURRENT@EXAMPLE.COM ", "192.0.2.41"),
    ]);
    expect(
      responses.map((response) => response.status).toSorted()
    ).toStrictEqual([200, 429]);
    const deliveries = await fetch(
      `https://api.resend.com/__test/delivery-count?email=${encodeURIComponent(email)}`
    );
    await expect(deliveries.json()).resolves.toBe(1);
    const records = await env.DB.prepare(
      "SELECT id FROM verification WHERE identifier = ?"
    )
      .bind(`sign-in-otp-${email}`)
      .all();
    expect(records.results).toHaveLength(1);
    await expectStatus(signIn(email, await readCode(email)), 200);
  });

  it.each([
    ["fifth@example.com", 4, 200],
    ["exhausted@example.com", 5, 403],
  ])(
    "enforces the five-attempt boundary for %s",
    async (email, failures, expected) => {
      await expectStatus(send(email), 200);
      const code = await readCode(email);
      const wrong = code === "000000" ? "111111" : "000000";
      for (let attempt = 0; attempt < failures; attempt += 1) {
        await expectStatus(signIn(email, wrong), 400);
      }
      await expectStatus(signIn(email, code), expected);
    }
  );

  it("rejects expired codes and reports delivery failure without creating a user", async () => {
    const email = "expired@example.com";
    await expectStatus(send(email), 200);
    const code = await readCode(email);
    await env.DB.prepare(
      "UPDATE verification SET expires_at = ? WHERE identifier = ?"
    )
      .bind(Date.now() - 1000, `sign-in-otp-${email}`)
      .run();
    await expectStatus(signIn(email, code), 400);
    await expectStatus(send("failure@example.com"), 502);
    await expect(
      env.DB.prepare("SELECT id FROM user WHERE email = ?")
        .bind("failure@example.com")
        .first()
    ).resolves.toBeNull();
  });

  it("limits sends per IP across different email addresses", async () => {
    for (let index = 0; index < 10; index += 1) {
      await expectStatus(send(`limit-${index}@example.com`, "192.0.2.99"), 200);
    }
    await expectStatus(send("limit-11@example.com", "192.0.2.99"), 429);
  });
});
