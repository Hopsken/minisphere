import { describe, expect, it } from "vitest";

import { getAvatarUrl } from "../src/lib/account";

describe("avatar URL", () => {
  it.each(["https://pds.example.com", "https://pds.example.com/"])(
    "uses one path separator with PDS URL %s",
    (service) => {
      expect(
        getAvatarUrl(
          service,
          "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
          "bafkreiavatar"
        )
      ).toBe(
        "https://pds.example.com/xrpc/com.atproto.sync.getBlob?cid=bafkreiavatar&did=did%3Aplc%3Aaaaaaaaaaaaaaaaaaaaaaaaa"
      );
    }
  );
});
