import * as DescribeRepo from "@atcute/atproto/types/repo/describeRepo";
import * as GetRecord from "@atcute/atproto/types/repo/getRecord";
import * as ListRecords from "@atcute/atproto/types/repo/listRecords";
import * as ListRepos from "@atcute/atproto/types/sync/listRepos";
import { fromUint8Array } from "@atcute/car";
import { decode } from "@atcute/cbor";
import { toString } from "@atcute/cid";
import {
  parsePrivateMultikey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import type { DidDocument } from "@atcute/identity";
import { DidNotFoundError } from "@atcute/identity-resolver";
import type { HandleResolver } from "@atcute/identity-resolver";
import type { Did } from "@atcute/lexicons/syntax";
import { parse } from "@atcute/lexicons/validations";
import { isNodeData } from "@atcute/mst";
import { Secp256k1Keypair } from "@atproto/crypto";
import {
  MemoryBlockstore,
  readCar,
  Repo,
  verifyDiffCar,
  verifyProofs,
  verifyRecords,
  verifyRepoCar,
  WriteOpAction,
} from "@atproto/repo";
import type { RecordCreateOp } from "@atproto/repo";
import { RepoDO } from "@minisphere/repo-do";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { createPdsDatabase } from "../src/db";
import { accountsTable } from "../src/db/schema";
import { AccountRepository } from "../src/repositories/account";
import { RepoReader } from "../src/services/repo-reader";

const COLLECTION = "app.example.item";
const HANDLE = "alice.example.com";
const KEYS = Array.from(
  { length: 105 },
  (_, index) => `key-${String(index).padStart(3, "0")}`
);
const recordValue = (rkey: string) => ({
  $type: COLLECTION,
  title: `Record ${rkey}`,
});

const query = (method: string, params: Record<string, string>) =>
  exports.default.fetch(
    new Request(
      `https://pds.test/xrpc/com.atproto.${method}?${new URLSearchParams(params)}`,
      {
        headers: { Origin: "https://pdsls.dev" },
      }
    )
  );

const exportRepo = async (did: Did, since?: string) => {
  const response = await query(
    "sync.getRepo",
    since === undefined ? { did } : { did, since }
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/vnd.ipld.car");
  return new Uint8Array(await response.arrayBuffer());
};

const seedRepo = async (keys: string[] = KEYS, registerAccount = true) => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const suffix = Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    (byte) => alphabet[byte % 32]
  ).join("");
  const did: Did<"plc"> = `did:plc:${suffix}`;
  const key = await Secp256k1PrivateKeyExportable.createKeypair();
  const privateKey = await key.exportPrivateKey("multikey");
  const publicKey = await key.exportPublicKey("did");
  const stub = env.REPO.getByName(did);
  await stub.reserveRepo(did, privateKey);
  const initial = await stub.rpcGetRepoStatus();

  if (keys.length > 0) {
    await runInDurableObject(stub, async (instance) => {
      assert.instanceOf(instance, RepoDO);
      let repo = await instance.getRepo();
      const signer = await Secp256k1Keypair.import(
        parsePrivateMultikey(privateKey).privateKeyBytes
      );
      const writes: RecordCreateOp[] = keys.map((rkey) => ({
        action: WriteOpAction.Create,
        collection: COLLECTION,
        record: recordValue(rkey),
        rkey,
      }));
      writes.push(
        {
          action: WriteOpAction.Create,
          collection: `${COLLECTION}.extra`,
          record: {
            bytes: new Uint8Array([0, 128, 255]),
            nested: [{ ref: repo.cid }],
            title: "before",
          },
          rkey: "self",
        },
        {
          action: WriteOpAction.Create,
          collection: `${COLLECTION}s`,
          record: { title: "after" },
          rkey: "self",
        }
      );
      // Prepare a large repository through small commits, within SQLite's bind limit.
      for (let offset = 0; offset < writes.length; offset += 10) {
        // Each commit must use the root produced by the previous one.
        // oxlint-disable-next-line no-await-in-loop
        repo = await repo.applyWrites(
          writes.slice(offset, offset + 10),
          signer
        );
      }
    });
    // Load the committed fixture from SQLite instead of the old in-memory root.
    await evictDurableObject(stub);
  }
  if (registerAccount) {
    await createPdsDatabase(env.PDS_DB).insert(accountsTable).values({ did });
  }
  return { did, initialCid: initial.head, publicKey, stub };
};

describe("public repository reads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])(
    "paginates all records without crossing collections (reverse=%s)",
    async (reverse) => {
      const { did } = await seedRepo();
      const expected = reverse ? KEYS : KEYS.toReversed();
      const first = await query("repo.listRecords", {
        collection: COLLECTION,
        limit: "100",
        repo: did,
        reverse: String(reverse),
      });
      expect({
        cors: first.headers.get("Access-Control-Allow-Origin"),
        status: first.status,
      }).toStrictEqual({ cors: "*", status: 200 });
      const page = parse(
        ListRecords.mainSchema.output.schema,
        await first.json()
      );
      expect(page.records).toStrictEqual(
        expected.slice(0, 100).map((rkey) => ({
          cid: expect.any(String),
          uri: `at://${did}/${COLLECTION}/${rkey}`,
          value: recordValue(rkey),
        }))
      );
      expect(page.cursor).toBe(expected[99]);
      assert.isDefined(page.cursor);

      const second = await query("repo.listRecords", {
        collection: COLLECTION,
        cursor: page.cursor,
        limit: "100",
        repo: did,
        reverse: String(reverse),
      });
      const lastPage = parse(
        ListRecords.mainSchema.output.schema,
        await second.json()
      );
      expect(lastPage.records.map((record) => record.uri)).toStrictEqual(
        expected.slice(100).map((rkey) => `at://${did}/${COLLECTION}/${rkey}`)
      );
      expect(lastPage.cursor).toBeUndefined();
    }
  );

  it("uses descending order and a limit of 50 by default", async () => {
    const { did } = await seedRepo();
    const response = await query("repo.listRecords", {
      collection: COLLECTION,
      repo: did,
    });
    const page = parse(
      ListRecords.mainSchema.output.schema,
      await response.json()
    );
    expect(page.records.map((record) => record.value)).toStrictEqual(
      KEYS.toReversed().slice(0, 50).map(recordValue)
    );
    expect(page.cursor).toBe("key-055");
  });

  it.each([false, true])(
    "handles exclusive cursors, exact pages and empty collections (reverse=%s)",
    async (reverse) => {
      const { did } = await seedRepo(["a", "m", "z"]);
      const params = {
        collection: COLLECTION,
        limit: "2",
        repo: did,
        reverse: String(reverse),
      };
      const response = await query("repo.listRecords", {
        ...params,
        cursor: "n",
      });
      const page = parse(
        ListRecords.mainSchema.output.schema,
        await response.json()
      );
      expect(page.records.map((record) => record.value)).toStrictEqual(
        (reverse ? ["z"] : ["m", "a"]).map(recordValue)
      );
      expect(page.cursor).toBeUndefined();
      const end = await query("repo.listRecords", {
        ...params,
        cursor: reverse ? "z" : "a",
      });
      await expect(end.json()).resolves.toStrictEqual({ records: [] });
      const empty = await query("repo.listRecords", {
        ...params,
        collection: "app.example.absent",
      });
      await expect(empty.json()).resolves.toStrictEqual({ records: [] });
    }
  );

  it("reads JSON records, checks CID selectors and reports missing records", async () => {
    const { did } = await seedRepo(["a", "z"]);
    const params = { collection: COLLECTION, repo: did, rkey: "a" };
    const response = await query("repo.getRecord", params);
    expect(response.status).toBe(200);
    const record = parse(
      GetRecord.mainSchema.output.schema,
      await response.json()
    );
    expect(record).toStrictEqual({
      cid: expect.any(String),
      uri: `at://${did}/${COLLECTION}/a`,
      value: recordValue("a"),
    });
    assert.isDefined(record.cid);
    const selected = await query("repo.getRecord", {
      ...params,
      cid: record.cid,
    });
    await expect(selected.json()).resolves.toStrictEqual(record);
    const other = await query("repo.getRecord", { ...params, rkey: "z" });
    const otherRecord = parse(
      GetRecord.mainSchema.output.schema,
      await other.json()
    );
    assert.isDefined(otherRecord.cid);
    await Promise.all(
      [{ rkey: "missing" }, { cid: otherRecord.cid }].map(async (overrides) => {
        const missing = await query("repo.getRecord", {
          ...params,
          ...overrides,
        });
        expect(missing.status).toBe(400);
        await expect(missing.json()).resolves.toMatchObject({
          error: "RecordNotFound",
        });
      })
    );
  });

  it.each(["m", "n"])(
    "streams a signed CAR proof for record %s",
    async (rkey) => {
      const { did, publicKey, stub } = await seedRepo(["a", "m", "z"]);
      const status = await stub.rpcGetRepoStatus();
      const response = await query("sync.getRecord", {
        collection: COLLECTION,
        did,
        rkey,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "application/vnd.ipld.car"
      );
      const bytes = new Uint8Array(await response.arrayBuffer());
      const car = fromUint8Array(bytes);
      expect(car.roots.map((root) => root.$link)).toStrictEqual([status.head]);
      const claims = [{ cid: null, collection: COLLECTION, rkey }];
      await expect(verifyRecords(bytes, did, publicKey)).resolves.toStrictEqual(
        rkey === "m"
          ? [{ collection: COLLECTION, record: recordValue(rkey), rkey }]
          : []
      );
      await expect(
        verifyProofs(bytes, claims, did, publicKey)
      ).resolves.toStrictEqual({
        unverified: rkey === "m" ? claims : [],
        verified: rkey === "n" ? claims : [],
      });
    }
  );

  it("reports the latest commit", async () => {
    const { did, stub } = await seedRepo(["a"]);
    const status = await stub.rpcGetRepoStatus();
    const response = await query("sync.getLatestCommit", { did });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      cid: status.head,
      rev: status.rev,
    });
  });

  it("exports the signed current repository without deleted records", async () => {
    const { did, publicKey, stub } = await seedRepo(["a", "m", "z"]);
    const removed = await stub.rpcGetRecord(COLLECTION, "m");
    assert.isNotNull(removed);
    await stub.rpcApplyWrites({
      writes: [{ action: "delete", collection: COLLECTION, rkey: "m" }],
    });
    const status = await stub.rpcGetRepoStatus();

    const bytes = await exportRepo(did);
    const car = await readCar(bytes);
    expect(car.roots.map(String)).toStrictEqual([status.head]);
    // The deleted record block is still stored but no longer reachable.
    expect(car.blocks.entries().map(({ cid }) => cid.toString())).not.toContain(
      removed.cid
    );
    const verified = await verifyRepoCar(bytes, did, publicKey);
    expect(verified.commit.cid.toString()).toBe(status.head);
    expect(
      verified.creates
        .filter((create) => create.collection === COLLECTION)
        .map((create) => create.rkey)
    ).toStrictEqual(["a", "z"]);
  });

  it("exports blocks written after a revision as a verifiable diff", async () => {
    const { did, publicKey, stub } = await seedRepo(["a", "m"]);
    const base = await readCar(await exportRepo(did));
    const { rev } = await stub.rpcGetRepoStatus();
    await stub.rpcApplyWrites({
      writes: [
        {
          action: "create",
          collection: COLLECTION,
          recordJson: JSON.stringify(recordValue("z")),
          rkey: "z",
        },
        { action: "delete", collection: COLLECTION, rkey: "m" },
      ],
    });
    const head = await stub.rpcGetRepoStatus();

    const diff = await exportRepo(did, rev);
    const [baseRoot] = base.roots;
    assert.isDefined(baseRoot);
    const baseRepo = await Repo.load(
      new MemoryBlockstore(base.blocks),
      baseRoot
    );
    const verified = await verifyDiffCar(baseRepo, diff, did, publicKey, {
      ensureLeaves: true,
    });
    expect(verified.commit.cid.toString()).toBe(head.head);
    expect(
      verified.writes.map((write) => `${write.action} ${write.rkey}`).toSorted()
    ).toStrictEqual([`${WriteOpAction.Create} z`, `${WriteOpAction.Delete} m`]);
    const [kept, created] = await Promise.all(
      ["a", "z"].map((rkey) => stub.rpcGetRecord(COLLECTION, rkey))
    );
    const diffCar = await readCar(diff);
    const diffCids = diffCar.blocks.entries().map(({ cid }) => cid.toString());
    expect(diffCids).toContain(created?.cid);
    expect(diffCids).not.toContain(kept?.cid);
  });

  it("exports blocks in depth-first preorder", async () => {
    const { did, stub } = await seedRepo();
    const head = await stub.rpcGetRepoStatus();
    const entries = [...fromUint8Array(await exportRepo(did))].map((entry) => ({
      cid: toString(entry.cid),
      data: decode(entry.bytes),
    }));
    const position = new Map(entries.map(({ cid }, index) => [cid, index]));
    const nodes = entries.flatMap(({ cid, data }) =>
      isNodeData(data) ? [{ cid, data }] : []
    );
    const childrenBeforeParent = nodes.flatMap(({ cid, data }) =>
      [data.l, ...data.e.flatMap((entry) => [entry.v, entry.t])]
        .filter((child) => child !== null)
        .filter(
          (child) =>
            (position.get(child.$link) ?? -1) < (position.get(cid) ?? 0)
        )
    );
    const listed = await query("repo.listRecords", {
      collection: COLLECTION,
      limit: "100",
      repo: did,
      reverse: "true",
    });
    const { records } = parse(
      ListRecords.mainSchema.output.schema,
      await listed.json()
    );
    const recordCids = new Set(records.map((record) => record.cid));
    const exportedRecords = entries
      .map(({ cid }) => cid)
      .filter((cid) => recordCids.has(cid));

    expect(entries[0]?.cid).toBe(head.head);
    expect(childrenBeforeParent).toStrictEqual([]);
    // Records follow key order and are interleaved with the nodes holding them.
    expect(exportedRecords).toStrictEqual(records.map((record) => record.cid));
    expect(position.get(nodes.at(-1)?.cid ?? "")).toBeGreaterThan(
      position.get(exportedRecords[0] ?? "") ?? Infinity
    );
  });

  it("exports only the changed path of a large repository after a revision", async () => {
    const { did, publicKey, stub } = await seedRepo();
    const full = await readCar(await exportRepo(did));
    const { rev } = await stub.rpcGetRepoStatus();
    await stub.rpcApplyWrites({
      writes: [
        {
          action: "update",
          collection: COLLECTION,
          recordJson: JSON.stringify({ $type: COLLECTION, title: "changed" }),
          rkey: "key-050",
        },
      ],
    });

    const diff = await exportRepo(did, rev);
    const [fullRoot] = full.roots;
    assert.isDefined(fullRoot);
    const verified = await verifyDiffCar(
      await Repo.load(new MemoryBlockstore(full.blocks), fullRoot),
      diff,
      did,
      publicKey,
      { ensureLeaves: true }
    );
    const diffCar = await readCar(diff);
    expect(verified.writes.map((write) => write.rkey)).toStrictEqual([
      "key-050",
    ]);
    // The commit, the nodes on the changed path, and the new record.
    expect(diffCar.blocks.size).toBeLessThan(10);
    expect(full.blocks.size).toBeGreaterThan(100);
  });

  it("exports only the commit root when nothing changed after a revision", async () => {
    const { did, stub } = await seedRepo(["a"]);
    const head = await stub.rpcGetRepoStatus();
    const unchanged = await readCar(await exportRepo(did, head.rev));
    expect(unchanged.roots.map(String)).toStrictEqual([head.head]);
    expect(unchanged.blocks.size).toBe(0);
  });

  it("preserves nested CID links and bytes in JSON records and lists", async () => {
    const { did, initialCid } = await seedRepo(["a"]);
    const collection = `${COLLECTION}.extra`;
    const expected = {
      cid: expect.any(String),
      uri: `at://${did}/${collection}/self`,
      value: {
        bytes: { $bytes: "AID/" },
        nested: [{ ref: { $link: initialCid } }],
        title: "before",
      },
    };
    const record = await query("repo.getRecord", {
      collection,
      repo: did,
      rkey: "self",
    });
    await expect(record.json()).resolves.toStrictEqual(expected);
    const list = await query("repo.listRecords", { collection, repo: did });
    await expect(list.json()).resolves.toStrictEqual({ records: [expected] });
  });

  it("lists hosted repositories page by page and omits unreadable ones", async () => {
    const seeded = await Promise.all([
      seedRepo([]),
      seedRepo([]),
      seedRepo([]),
    ]);
    const unreadable: Did = "did:plc:unreadablerepositorytest0";
    await createPdsDatabase(env.PDS_DB)
      .insert(accountsTable)
      .values({ did: unreadable });

    const listFrom = async (
      cursor?: string
    ): Promise<ListRepos.$output["repos"]> => {
      const response = await query(
        "sync.listRepos",
        cursor === undefined ? { limit: "2" } : { cursor, limit: "2" }
      );
      const page = parse(
        ListRepos.mainSchema.output.schema,
        await response.json()
      );
      return page.cursor === undefined
        ? page.repos
        : [...page.repos, ...(await listFrom(page.cursor))];
    };
    const listed = await listFrom();

    const dids = listed.map((repo) => repo.did);
    const expected = await Promise.all(
      seeded.map(async ({ did, stub }) => {
        const { head, rev } = await stub.rpcGetRepoStatus();
        return { active: true, did, head, rev };
      })
    );
    expect(dids).toStrictEqual(dids.toSorted());
    expect(new Set(dids).size).toBe(dids.length);
    expect(listed).toStrictEqual(expect.arrayContaining(expected));
    expect(dids).not.toContain(unreadable);
  });

  it("does not expose initialized repositories without a local account", async () => {
    const { did } = await seedRepo([], false);
    const requests: [string, Record<string, string>][] = [
      ["repo.describeRepo", { repo: did }],
      ["repo.listRecords", { collection: COLLECTION, repo: did }],
      ["repo.getRecord", { collection: COLLECTION, repo: did, rkey: "self" }],
      ["sync.getRecord", { collection: COLLECTION, did, rkey: "self" }],
      ["sync.getLatestCommit", { did }],
      ["sync.getRepo", { did }],
    ];
    await Promise.all(
      requests.map(async ([method, params]) => {
        const response = await query(method, params);
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          error: "RepoNotFound",
        });
      })
    );
  });

  it.each([
    { limit: "101" },
    { limit: "0" },
    { reverse: "yes" },
    { cursor: "other/collection" },
  ])("rejects invalid list parameters %j", async (params) => {
    const response = await query("repo.listRecords", {
      collection: COLLECTION,
      repo: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
      ...params,
    });
    expect(response.status).toBe(400);
  });

  it("describes the repo through the configured PLC and resolves handle inputs", async () => {
    const { did } = await seedRepo(["a"]);
    const document: DidDocument = { alsoKnownAs: [`at://${HANDLE}`], id: did };
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      if (
        url.origin === "https://directory.test" &&
        decodeURIComponent(url.pathname) === `/${did}`
      ) {
        return Promise.resolve(Response.json(document));
      }
      if (url.hostname === HANDLE) {
        return Promise.resolve(new Response(did));
      }
      if (url.hostname === "cloudflare-dns.com") {
        return Promise.resolve(
          Response.json({
            Answer: [{ data: `"did=${did}"`, type: 16 }],
            Status: 0,
          })
        );
      }
      throw new Error(`Unexpected identity request: ${url}`);
    });
    vi.stubGlobal("fetch", fetcher);
    const response = await query("repo.describeRepo", { repo: HANDLE });
    expect(response.status).toBe(200);
    const description = parse(
      DescribeRepo.mainSchema.output.schema,
      await response.json()
    );
    expect(description).toStrictEqual({
      collections: [`${COLLECTION}.extra`, COLLECTION, `${COLLECTION}s`],
      did,
      didDoc: document,
      handle: HANDLE,
      handleIsCorrect: true,
    });
    const record = await query("repo.getRecord", {
      collection: COLLECTION,
      repo: HANDLE,
      rkey: "a",
    });
    await expect(record.json()).resolves.toMatchObject({
      uri: `at://${did}/${COLLECTION}/a`,
    });
  });

  it.each(["mismatch", "unresolved", "missing"])(
    "reports an unverified handle without hiding the repo (%s)",
    async (scenario) => {
      const { did } = await seedRepo([]);
      const handles: HandleResolver = {
        resolve: () =>
          scenario === "unresolved"
            ? Promise.reject(new DidNotFoundError(HANDLE))
            : Promise.resolve("did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"),
      };
      const didDoc: DidDocument = {
        alsoKnownAs: scenario === "missing" ? [] : [`at://${HANDLE}`],
        id: did,
      };
      const reader = new RepoReader(
        new AccountRepository(createPdsDatabase(env.PDS_DB)),
        env.REPO,
        handles,
        { resolve: () => Promise.resolve(didDoc) }
      );
      await expect(reader.describe(did)).resolves.toStrictEqual({
        collections: [],
        did,
        didDoc,
        handle: scenario === "missing" ? "handle.invalid" : HANDLE,
        handleIsCorrect: false,
      });
    }
  );
});
