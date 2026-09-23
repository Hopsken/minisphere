import { P256Keypair } from "@atproto/crypto";
import { cidForLex } from "@atproto/lex-cbor";
import * as plc from "@did-plc/lib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { migrateGenesis } from "../scripts/migrate-genesis.ts";

const source = "https://old-plc.test";
const target = "https://new-plc.test";

const fixture = async () => {
  const key = await P256Keypair.create();
  const { did, op } = await plc.createOp({
    handle: "alice.example.com",
    pds: "pds.example.com",
    rotationKeys: [key.did()],
    signer: key,
    signingKey: key.did(),
  });
  const cid = await cidForLex(op);
  const entry = {
    cid: cid.toString(),
    did,
    nullified: false,
    operation: op,
  };
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected request"));
  return { did, entry, http, op };
};

describe("genesis migration", () => {
  afterEach(() => vi.restoreAllMocks());

  it("defaults to a read-only plan", async () => {
    const { did, entry, http, op } = await fixture();
    http
      .mockResolvedValueOnce(Response.json([entry]))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(
      migrateGenesis({ did, source, target })
    ).resolves.toStrictEqual({
      cid: entry.cid,
      operation: op,
      status: "ready (dry run; no writes)",
    });
    expect(
      http.mock.calls.map(([url, init]) => [url, init?.method])
    ).toStrictEqual([
      [`${source}/${encodeURIComponent(did)}/log/audit`, undefined],
      [`${target}/${encodeURIComponent(did)}/log/audit`, undefined],
    ]);
  });

  it("posts the original signed operation and verifies the target", async () => {
    const { did, entry, http, op } = await fixture();
    http
      .mockResolvedValueOnce(Response.json([entry]))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json([entry]))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json([entry]));
    await expect(
      migrateGenesis({ apply: true, did, source, target })
    ).resolves.toMatchObject({ status: "migrated" });
    expect(http).toHaveBeenNthCalledWith(
      4,
      `${target}/${encodeURIComponent(did)}`,
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(String(http.mock.calls[3]?.[1]?.body))).toStrictEqual(op);
    expect(http).toHaveBeenCalledTimes(5);
  });

  it("skips an identical target without writing", async () => {
    const { did, entry, http } = await fixture();
    http
      .mockResolvedValueOnce(Response.json([entry]))
      .mockResolvedValueOnce(Response.json([entry]));
    await expect(
      migrateGenesis({ apply: true, did, source, target })
    ).resolves.toMatchObject({ status: "already-present" });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each(["source", "target", "source recheck"] as const)(
    "rejects extra audit history in %s before writing",
    async (location) => {
      const { did, entry, http } = await fixture();
      const histories = {
        source: [[entry, { ...entry, nullified: true }]],
        "source recheck": [[entry], null, [entry, entry]],
        target: [[entry], [entry, entry]],
      };
      for (const history of histories[location]) {
        http.mockResolvedValueOnce(
          history ? Response.json(history) : new Response(null, { status: 404 })
        );
      }
      await expect(
        migrateGenesis({ apply: true, did, source, target })
      ).rejects.toThrow("expected exactly one non-nullified genesis");
      expect(http.mock.calls.every(([, init]) => !init?.method)).toBeTruthy();
    }
  );

  it.each([401, 500])("does not treat HTTP %s as absence", async (status) => {
    const { did, entry, http } = await fixture();
    http
      .mockResolvedValueOnce(Response.json([entry]))
      .mockResolvedValueOnce(new Response(null, { status }));
    await expect(
      migrateGenesis({ apply: true, did, source, target })
    ).rejects.toThrow(`HTTP ${status}`);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("rejects a genesis belonging to another DID", async () => {
    const { entry, http } = await fixture();
    const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
    http.mockResolvedValueOnce(Response.json([{ ...entry, did }]));
    await expect(
      migrateGenesis({ apply: true, did, source, target })
    ).rejects.toThrow(Error);
    expect(http).toHaveBeenCalledOnce();
  });

  it("does not report success when a successful POST is not visible", async () => {
    const { did, entry, http } = await fixture();
    http
      .mockResolvedValueOnce(Response.json([entry]))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json([entry]))
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(
      migrateGenesis({ apply: true, did, source, target })
    ).rejects.toThrow("Target verification failed");
  });
});
