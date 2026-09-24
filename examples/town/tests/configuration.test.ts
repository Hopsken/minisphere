import { describe, expect, it } from "vitest";

import app from "../worker";

const PUBLIC_URL = "https://town.example.com";
describe("Town configuration", () => {
  it.each(["", "ftp://plc.test"])(
    "rejects explicit invalid directory %j",
    async (PLC_DIRECTORY) => {
      const response = await app.request(
        "https://town.example.com/api/configuration",
        undefined,
        { PLC_DIRECTORY, PUBLIC_URL }
      );
      expect(response.status).toBe(500);
    }
  );

  it("reads the public directory when omitted", async () => {
    const response = await app.request(
      "https://town.example.com/api/did-documents/did:plc:bbbbbbbbbbbbbbbbbbbbbbbb",
      undefined,
      { PUBLIC_URL }
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      alsoKnownAs: ["at://public.example.com"],
    });
  });

  it("does not fall back when an explicit private directory fails", async () => {
    const response = await app.request(
      "https://town.example.com/api/did-documents/did:plc:bbbbbbbbbbbbbbbbbbbbbbbb",
      undefined,
      { PLC_DIRECTORY: "https://plc.test", PUBLIC_URL }
    );
    expect(response.status).toBe(404);
  });
});
