import { env, withEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { resolveConfig } from "../worker/config";

const defaults = {
  ...env,
  MINISPHERE_ORIGIN: "https://minisphere.test",
  PDS_ORIGIN: undefined,
  PLC_DIRECTORY: undefined,
  PUBLIC_HANDLE_DOMAIN: undefined,
};

describe("Accounts configuration", () => {
  it("derives service origins and handles and defaults to the official PLC Directory", () => {
    expect(withEnv(defaults, resolveConfig)).toStrictEqual({
      accountsOrigin: "https://minisphere.test",
      handleDomain: "minisphere.test",
      pdsOrigin: "https://pds.minisphere.test",
      plcDirectory: "https://plc.directory",
    });
  });

  it("reads local overrides from the current Worker environment on each call", () => {
    expect(
      withEnv(
        {
          ...defaults,
          MINISPHERE_ORIGIN: "http://localhost:8790",
          PDS_ORIGIN: "http://localhost:8787",
          PLC_DIRECTORY: "http://localhost:8788",
          PUBLIC_HANDLE_DOMAIN: "handles.test",
        },
        resolveConfig
      )
    ).toStrictEqual({
      accountsOrigin: "http://localhost:8790",
      handleDomain: "handles.test",
      pdsOrigin: "http://localhost:8787",
      plcDirectory: "http://localhost:8788",
    });
    expect(withEnv(defaults, () => resolveConfig().plcDirectory)).toBe(
      "https://plc.directory"
    );
  });

  it("requires the base origin even with a PDS override", () => {
    expect(() =>
      withEnv(
        {
          ...defaults,
          MINISPHERE_ORIGIN: undefined,
          PDS_ORIGIN: "https://pds.test",
        },
        resolveConfig
      )
    ).toThrow(/MINISPHERE_ORIGIN/u);
  });

  it.each([
    "",
    "not-a-url",
    "ftp://example.com",
    "https://example.com/path",
    "https://user:password@example.com",
    "https://example.com?query=1",
    "https://example.com/",
    "https://example.com#fragment",
  ])(
    "rejects invalid explicit origins rather than using defaults: %s",
    (origin) => {
      expect(() =>
        withEnv({ ...defaults, MINISPHERE_ORIGIN: origin }, resolveConfig)
      ).toThrow(/MINISPHERE_ORIGIN/u);
      expect(() =>
        withEnv({ ...defaults, PDS_ORIGIN: origin }, resolveConfig)
      ).toThrow(/PDS_ORIGIN/u);
      expect(() =>
        withEnv({ ...defaults, PLC_DIRECTORY: origin }, resolveConfig)
      ).toThrow(/PLC_DIRECTORY/u);
    }
  );

  it("rejects an empty explicit handle domain", () => {
    expect(() =>
      withEnv({ ...defaults, PUBLIC_HANDLE_DOMAIN: "" }, resolveConfig)
    ).toThrow(/PUBLIC_HANDLE_DOMAIN/u);
  });
});
