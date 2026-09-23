import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlcDirectoryClient } from "../worker/clients/plc-directory-client";

describe("PLC HTTP client", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["http://localhost:8788", "https://plc.directory"])(
    "reads state from %s",
    async (origin) => {
      const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
      const key = await Secp256k1PrivateKeyExportable.createKeypair();
      const publicKey = await key.exportPublicKey("did");
      const state = {
        alsoKnownAs: ["at://alice.example.com"],
        did,
        rotationKeys: [publicKey],
        services: {},
        verificationMethods: { atproto: publicKey },
      };
      const http = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input, init) => {
          expect(new Request(input, init).url).toBe(
            `${origin}/${encodeURIComponent(did)}/data`
          );
          return Promise.resolve(Response.json(state));
        });

      await expect(
        new PlcDirectoryClient(origin).getState(did)
      ).resolves.toStrictEqual(state);
      expect(http).toHaveBeenCalledOnce();
    }
  );

  it("rejects an empty origin without sending a public request", () => {
    const http = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected request"));
    expect(() => new PlcDirectoryClient("")).toThrow(TypeError);
    expect(http).not.toHaveBeenCalled();
  });

  it("does not switch directories after a failure", async () => {
    const http = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Directory unavailable"));
    await expect(
      new PlcDirectoryClient("https://private-plc.example.com").getState(
        "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
      )
    ).rejects.toThrow("Directory unavailable");
    expect(http).toHaveBeenCalledOnce();
  });
});
