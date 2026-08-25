import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const request = (path: string): Promise<Response> =>
  exports.default.fetch(
    new Request(`https://accounts.test${path}`, { redirect: "manual" })
  );

describe("development login route", () => {
  it("logs a browser in as an existing or new local user", async () => {
    const loginResponse = await request(
      "/__dev/log-me-in/dev%40example.com?returnTo=%2Fsettings"
    );

    expect({
      location: loginResponse.headers.get("location"),
      status: loginResponse.status,
    }).toStrictEqual({ location: "/settings", status: 302 });

    const setCookie = loginResponse.headers.get("set-cookie");
    expect(setCookie?.split("; ")).toStrictEqual([
      expect.stringMatching(/^__Secure-better-auth\.session_token=.+$/u),
      "Max-Age=604800",
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
    ]);

    const sessionResponse = await exports.default.fetch(
      new Request("https://accounts.test/api/auth/get-session", {
        headers: { cookie: setCookie?.split(";", 1)[0] ?? "" },
      })
    );

    expect({
      body: await sessionResponse.json(),
      status: sessionResponse.status,
    }).toMatchObject({
      body: { user: { email: "dev@example.com" } },
      status: 200,
    });

    const secondLoginResponse = await request(
      "/__dev/log-me-in/dev%40example.com"
    );
    expect(secondLoginResponse.headers.get("location")).toBe("/");

    const users = await env.DB.prepare(
      "SELECT email, name FROM user WHERE email = ?"
    )
      .bind("dev@example.com")
      .all<{ email: string; name: string }>();
    expect(users.results).toStrictEqual([
      { email: "dev@example.com", name: "dev@example.com" },
    ]);
  });

  it.each([
    "settings",
    "https://example.net/settings",
    "//example.net/settings",
    "/\\example.net/settings",
  ])("rejects unsafe returnTo value %s", async (returnTo) => {
    const response = await request(
      `/__dev/log-me-in/redirect%40example.com?returnTo=${encodeURIComponent(returnTo)}`
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });

  it("rejects an invalid email route parameter", async () => {
    const response = await request("/__dev/log-me-in/not-an-email");

    expect(response.status).toBe(400);
  });
});
