import { describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config";

const production = {
  MINISPHERE_ORIGIN: "https://r2d2.party",
  PLC_DIRECTORY: "https://directory.example.net",
};

describe("PDS configuration", () => {
  it("derives the paired service origins without handle configuration", () => {
    const input = { ...production, DB: {}, PUBLIC_HANDLE_DOMAIN: "" };
    expect(resolveConfig(input)).toStrictEqual({
      accountsOrigin: "https://r2d2.party",
      pdsOrigin: "https://pds.r2d2.party",
      plcDirectory: "https://directory.example.net",
    });
  });

  it("supports a separate local PDS port", () => {
    expect(
      resolveConfig({
        MINISPHERE_ORIGIN: "http://localhost:8790",
        PDS_ORIGIN: "http://localhost:8787",
        PLC_DIRECTORY: "http://localhost:8788",
      })
    ).toStrictEqual({
      accountsOrigin: "http://localhost:8790",
      pdsOrigin: "http://localhost:8787",
      plcDirectory: "http://localhost:8788",
    });
  });

  it.each(["MINISPHERE_ORIGIN", "PLC_DIRECTORY"])(
    "requires the binding even with a PDS override: %s",
    (key) => {
      const input = { ...production, PDS_ORIGIN: "http://localhost:8787" };
      Reflect.deleteProperty(input, key);
      expect(() => resolveConfig(input)).toThrow(new RegExp(key, "u"));
    }
  );

  it.each([
    "",
    "not-a-url",
    "ftp://example.com",
    "https://example.com/path",
    "https://user:password@example.com",
    "https://example.com?query=1",
    "https://example.com/",
    "https://example.com#fragment",
  ])("rejects non-canonical origins in every origin binding: %s", (origin) => {
    expect(() =>
      resolveConfig({ ...production, MINISPHERE_ORIGIN: origin })
    ).toThrow(/MINISPHERE_ORIGIN/u);
    expect(() => resolveConfig({ ...production, PDS_ORIGIN: origin })).toThrow(
      /PDS_ORIGIN/u
    );
    expect(() =>
      resolveConfig({ ...production, PLC_DIRECTORY: origin })
    ).toThrow(/PLC_DIRECTORY/u);
  });
});
