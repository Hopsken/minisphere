import { describe, expect, it } from "vitest";

import { resolveConfig } from "../worker/config";

const production = {
  MINISPHERE_ORIGIN: "https://accounts.example.com",
  PLC_DIRECTORY: "https://directory.example.net",
};

describe("Accounts configuration", () => {
  it("derives service origins and handles from the base hostname", () => {
    expect(resolveConfig(production)).toStrictEqual({
      accountsOrigin: "https://accounts.example.com",
      handleDomain: "accounts.example.com",
      pdsOrigin: "https://pds.accounts.example.com",
      plcDirectory: "https://directory.example.net",
    });
  });

  it("supports separate local ports and a local handle domain", () => {
    expect(
      resolveConfig({
        MINISPHERE_ORIGIN: "http://localhost:8790",
        PDS_ORIGIN: "http://localhost:8787",
        PLC_DIRECTORY: "http://localhost:8788",
        PUBLIC_HANDLE_DOMAIN: "r2d2.test",
      })
    ).toStrictEqual({
      accountsOrigin: "http://localhost:8790",
      handleDomain: "r2d2.test",
      pdsOrigin: "http://localhost:8787",
      plcDirectory: "http://localhost:8788",
    });
  });

  it("requires the base origin even when local overrides are provided", () => {
    expect(() =>
      resolveConfig({
        ...production,
        MINISPHERE_ORIGIN: "",
        PDS_ORIGIN: "http://localhost:8787",
        PUBLIC_HANDLE_DOMAIN: "r2d2.test",
      })
    ).toThrow(/MINISPHERE_ORIGIN/u);
  });

  it.each([
    "not-a-url",
    "ftp://example.com",
    "https://example.com/path",
    "https://user:password@example.com",
    "https://example.com?query=1",
    "https://example.com/",
    "https://example.com#fragment",
  ])("rejects a non-canonical base origin: %s", (origin) => {
    expect(() =>
      resolveConfig({ ...production, MINISPHERE_ORIGIN: origin })
    ).toThrow(/MINISPHERE_ORIGIN/u);
  });

  it("requires an explicit PLC Directory without a public fallback", () => {
    expect(() => resolveConfig({ ...production, PLC_DIRECTORY: "" })).toThrow(
      /PLC_DIRECTORY/u
    );
  });

  it.each(["MINISPHERE_ORIGIN", "PLC_DIRECTORY"])(
    "rejects a missing required binding: %s",
    (key) => {
      const input = { ...production };
      Reflect.deleteProperty(input, key);
      expect(() => resolveConfig(input)).toThrow(new RegExp(key, "u"));
    }
  );

  it("validates optional and required origins with the same schema", () => {
    expect(() =>
      resolveConfig({ ...production, PDS_ORIGIN: "https://pds.example/path" })
    ).toThrow(/PDS_ORIGIN/u);
    expect(() =>
      resolveConfig({ ...production, PLC_DIRECTORY: "ftp://directory.example" })
    ).toThrow(/PLC_DIRECTORY/u);
    expect(() =>
      resolveConfig({ ...production, PUBLIC_HANDLE_DOMAIN: "" })
    ).toThrow(/PUBLIC_HANDLE_DOMAIN/u);
  });

  it("accepts Worker bindings outside the configuration schema", () => {
    const input = { ...production, DB: {}, PDS: {} };
    expect(resolveConfig(input)).toStrictEqual({
      accountsOrigin: "https://accounts.example.com",
      handleDomain: "accounts.example.com",
      pdsOrigin: "https://pds.accounts.example.com",
      plcDirectory: "https://directory.example.net",
    });
  });
});
