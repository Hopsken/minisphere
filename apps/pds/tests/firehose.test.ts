import * as SubscribeRepos from "@atcute/atproto/types/sync/subscribeRepos";
import { fromBytes } from "@atcute/cbor";
import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import type { Did } from "@atcute/lexicons/syntax";
import { parse } from "@atcute/lexicons/validations";
import { parseCid } from "@atproto/lex-data";
import {
  def,
  getAndParseByDef,
  MemoryBlockstore,
  MST,
  readCarWithRoot,
  verifyCommitSig,
} from "@atproto/repo";
import { SEQUENCER_NAME } from "@minisphere/pds-sequencer-do";
import type { RepoWrite } from "@minisphere/repo-do";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { assert, describe, expect, it } from "vitest";

import { createPdsDatabase } from "../src/db";
import { accountsTable } from "../src/db/schema";
import { aboutRepo, subscribe } from "./firehose-client";
import type { FirehoseFrame } from "./firehose-client";

const COLLECTION = "app.example.item";
const sequencer = () => env.SEQUENCER.getByName(SEQUENCER_NAME);

const createRepo = async () => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const suffix = Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    (byte) => alphabet[byte % 32]
  ).join("");
  const did: Did<"plc"> = `did:plc:${suffix}`;
  const key = await Secp256k1PrivateKeyExportable.createKeypair();
  const stub = env.REPO.getByName(did);
  await stub.reserveRepo(did, await key.exportPrivateKey("multikey"));
  await createPdsDatabase(env.PDS_DB).insert(accountsTable).values({ did });
  const put = (rkey: string, title = rkey): RepoWrite => ({
    action: "put",
    collection: COLLECTION,
    recordJson: JSON.stringify({ $type: COLLECTION, title }),
    rkey,
  });
  const remove = (rkey: string): RepoWrite => ({
    action: "delete",
    collection: COLLECTION,
    rkey,
  });
  const apply = async (writes: RepoWrite[]) => {
    const result = await stub.rpcApplyWrites({ writes });
    assert.notProperty(result, "error");
    return stub.rpcGetRepoStatus();
  };
  return {
    apply,
    did,
    publicKey: await key.exportPublicKey("did"),
    put,
    remove,
    stub,
  };
};

const isCommit = (frame: FirehoseFrame) =>
  frame.header.op === 1 && frame.header.t === "#commit";

/** Verify a commit event as a relay does: signature, then invert its ops onto `prevData`. */
const verifyCommitEvent = async (frame: FirehoseFrame, publicKey: string) => {
  const event = parse(SubscribeRepos.commitSchema, frame.body);
  const car = await readCarWithRoot(fromBytes(event.blocks));
  const { obj: commit } = await getAndParseByDef(
    car.blocks,
    car.root,
    def.commit
  );
  const missing = event.ops.filter(
    (op) => op.cid && !car.blocks.has(parseCid(op.cid.$link))
  );
  assert.isEmpty(missing);
  // Undo each op on the new tree; a complete proof yields the previous root.
  let inverted = MST.load(new MemoryBlockstore(car.blocks), commit.data);
  for (const op of event.ops) {
    if (op.action === "create") {
      // oxlint-disable-next-line no-await-in-loop -- Each inversion applies to the previous tree.
      inverted = await inverted.delete(op.path);
    } else {
      assert.isDefined(op.prev);
      const prev = parseCid(op.prev.$link);
      // oxlint-disable-next-line no-await-in-loop -- Each inversion applies to the previous tree.
      inverted = await (op.action === "update"
        ? inverted.update(op.path, prev)
        : inverted.add(op.path, prev));
    }
  }
  const invertedData = await inverted.getPointer();
  return {
    commit: event.commit.$link,
    inverted: invertedData.toString() === event.prevData?.$link,
    ops: event.ops.map((op) => ({
      action: op.action,
      path: op.path,
      prev: op.prev !== undefined,
    })),
    rev: event.rev,
    seq: event.seq,
    signed: await verifyCommitSig(commit, publicKey),
    since: event.since,
  };
};

describe("com.atproto.sync.subscribeRepos", () => {
  it("streams signed commit events whose net ops invert to the previous data", async () => {
    const repo = await createRepo();
    const genesis = await repo.stub.rpcGetRepoStatus();
    const firehose = await subscribe();
    const first = await repo.apply([repo.put("a"), repo.put("b")]);
    const second = await repo.apply([
      repo.put("a", "changed"),
      repo.remove("b"),
      repo.put("c"),
      // Created and deleted within one batch: no net change to report.
      repo.put("d"),
      repo.remove("d"),
    ]);

    const frames = await firehose.take(2, aboutRepo(repo.did));
    const events = await Promise.all(
      frames.map((frame) => verifyCommitEvent(frame, repo.publicKey))
    );
    firehose.close();
    expect(frames.every(isCommit)).toBeTruthy();
    expect(events[1]?.seq).toBeGreaterThan(events[0]?.seq ?? Infinity);
    expect(events.map(({ seq: _seq, ...event }) => event)).toStrictEqual([
      {
        commit: first.head,
        inverted: true,
        ops: [
          { action: "create", path: `${COLLECTION}/a`, prev: false },
          { action: "create", path: `${COLLECTION}/b`, prev: false },
        ],
        rev: first.rev,
        signed: true,
        since: genesis.rev,
      },
      {
        commit: second.head,
        inverted: true,
        ops: [
          { action: "update", path: `${COLLECTION}/a`, prev: true },
          { action: "delete", path: `${COLLECTION}/b`, prev: true },
          { action: "create", path: `${COLLECTION}/c`, prev: false },
        ],
        rev: second.rev,
        signed: true,
        since: first.rev,
      },
    ]);
  });

  it("replays after a cursor and rejects a future cursor", async () => {
    const repo = await createRepo();
    const live = await subscribe();
    await repo.apply([repo.put("a")]);
    await repo.apply([repo.put("b")]);
    const [first, second] = await live.take(2, aboutRepo(repo.did));
    live.close();
    assert.isDefined(first);
    assert.isDefined(second);
    const cursor = parse(SubscribeRepos.commitSchema, first.body).seq;

    const replay = await subscribe(cursor);
    const [replayed] = await replay.take(1, aboutRepo(repo.did));
    replay.close();
    expect(replayed?.bodyBytes).toStrictEqual(second.bodyBytes);

    const future = await subscribe(cursor + 1_000_000);
    const [error] = await future.take(1, () => true);
    expect(error).toMatchObject({
      body: { error: "FutureCursor" },
      header: { op: -1 },
    });
    await expect(future.closed()).resolves.toBe(1008);
  });

  it("reports an outdated cursor after pruning and replays retained events", async () => {
    const repo = await createRepo();
    const live = await subscribe();
    await repo.apply([repo.put("a")]);
    await repo.apply([repo.put("b")]);
    const [expired, retained] = await live.take(2, aboutRepo(repo.did));
    live.close();
    assert.isDefined(expired);
    assert.isDefined(retained);
    const expiredSeq = parse(SubscribeRepos.commitSchema, expired.body).seq;
    await runInDurableObject(sequencer(), (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE events SET created_at = 0 WHERE seq <= ?",
        expiredSeq
      );
    });
    await runDurableObjectAlarm(sequencer());

    const replay = await subscribe(0);
    const [info] = await replay.take(1, () => true);
    const [first] = await replay.take(1, aboutRepo(repo.did));
    replay.close();
    expect(info).toMatchObject({
      body: { name: "OutdatedCursor" },
      header: { op: 1, t: "#info" },
    });
    expect(first?.bodyBytes).toStrictEqual(retained.bodyBytes);
  });

  it("keeps committed writes when sequencing fails and redelivers them from the alarm", async () => {
    const repo = await createRepo();
    const firehose = await subscribe();
    await runInDurableObject(sequencer(), (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER fail_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'test failure'); END"
      );
    });
    const committed = await repo.apply([repo.put("a")]);
    await expect(
      repo.stub.rpcGetRecord(COLLECTION, "a")
    ).resolves.not.toBeNull();
    const early = await firehose.received();
    expect(early.filter(aboutRepo(repo.did))).toStrictEqual([]);

    await runInDurableObject(sequencer(), (_instance, state) => {
      state.storage.sql.exec("DROP TRIGGER fail_events");
    });
    await expect(runDurableObjectAlarm(repo.stub)).resolves.toBeTruthy();
    const [delivered] = await firehose.take(1, aboutRepo(repo.did));
    firehose.close();
    assert.isDefined(delivered);
    expect(parse(SubscribeRepos.commitSchema, delivered.body)).toMatchObject({
      commit: { $link: committed.head },
      rev: committed.rev,
    });
  });

  it("requires a WebSocket upgrade", async () => {
    const response = await exports.default.fetch(
      "https://pds.test/xrpc/com.atproto.sync.subscribeRepos"
    );
    expect(response.status).toBe(426);
  });
});
