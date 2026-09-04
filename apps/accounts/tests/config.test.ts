import { describe, expect, it } from "vitest";

import { configSchema } from "../worker/config";

const validVariables = {
  ACCOUNTS_OAUTH_SIGNING_KEY:
    "z3vLgutAnqAMEebBpzwLH6XXgsbGAfj7EM4xtwdikAXkDirW",
  ACCOUNTS_PLC_ROTATION_KEY: "z3vLkg9CfGbLKz4hVw59gaeakjfwZZ1mzG6VFpiCnXuGUXFe",
  BETTER_AUTH_SECRET: "test-better-auth-secret-at-least-32-characters",
  OIDC_PROVIDER_NAME: "Test Identity",
  PDS_ORIGIN: "https://pds.test",
  PUBLIC_HANDLE_DOMAIN: "r2d2.test",
  PUBLIC_URL: "https://accounts.test",
};

describe("accounts configuration", () => {
  it("accepts an absent OIDC provider", () => {
    expect(configSchema.parse(validVariables)).toMatchObject({
      oidc: null,
      pdsOrigin: "https://pds.test",
      publicHandleDomain: "r2d2.test",
      publicUrl: "https://accounts.test",
    });
  });

  it("accepts local development origins", () => {
    expect(
      configSchema.parse({
        ...validVariables,
        PDS_ORIGIN: "http://127.0.0.1:8787",
        PUBLIC_URL: "http://localhost:8790",
      })
    ).toMatchObject({
      pdsOrigin: "http://127.0.0.1:8787",
      publicUrl: "http://localhost:8790",
    });
  });

  it("accepts a complete OIDC provider", () => {
    expect(
      configSchema.parse({
        ...validVariables,
        OIDC_CLIENT_ID: "accounts-test-client",
        "OIDC_CLIENT_SE\u0043RET": "accounts-test-client-secret",
        OIDC_DISCOVERY_URL:
          "https://oidc.test/.well-known/openid-configuration",
      }).oidc
    ).toStrictEqual({
      clientId: "accounts-test-client",
      clientSecret: "accounts-test-client-secret",
      discoveryUrl: "https://oidc.test/.well-known/openid-configuration",
      providerName: "Test Identity",
    });
  });

  it("rejects a partial OIDC provider", () => {
    const result = configSchema.safeParse({
      ...validVariables,
      OIDC_CLIENT_ID: "accounts-test-client",
    });

    expect(result.success).toBeFalsy();
    if (result.success) {
      return;
    }
    expect(result.error.issues.map((issue) => issue.path)).toStrictEqual([
      ["OIDC_CLIENT_SECRET"],
      ["OIDC_DISCOVERY_URL"],
    ]);
  });

  it.each([
    ["ACCOUNTS_OAUTH_SIGNING_KEY", "invalid"],
    ["ACCOUNTS_PLC_ROTATION_KEY", "invalid"],
    ["BETTER_AUTH_SECRET", "too-short"],
    ["PDS_ORIGIN", "https://pds.test/path"],
    ["PUBLIC_HANDLE_DOMAIN", "not/a/hostname"],
    ["PUBLIC_URL", "https://accounts.test/path"],
  ])("rejects invalid %s", (name, value) => {
    const result = configSchema.safeParse({
      ...validVariables,
      [name]: value,
    });

    expect(result.success).toBeFalsy();
    if (result.success) {
      return;
    }
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({ path: [name] })
    );
  });
});
