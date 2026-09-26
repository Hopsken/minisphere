import { parsePrivateMultikey } from "@atcute/crypto";
import { Secp256k1Keypair } from "@atproto/crypto";
import { lexToJson } from "@atproto/lex-json";
import { getRecords, Repo } from "@atproto/repo";
import type { Leaf } from "@atproto/repo";
import { SEQUENCER_NAME } from "@minisphere/pds-sequencer-do";
import { DurableObject } from "cloudflare:workers";

import type { BlobMetadata } from "./blobs";
import { CoreStorage } from "./core";
import { createDatabase } from "./db";
import { accountAnnouncementEvents, commitEvent } from "./events";
import type { RepoEnv } from "./events";
import { exportRepoCar } from "./export";
import { prepareCommit } from "./writes";
import type { RepoWriteRequest, RepoWriteResponse } from "./writes";

const importSigningKey = (signingKey: string): Promise<Secp256k1Keypair> => {
  const parsedKey = parsePrivateMultikey(signingKey);
  if (parsedKey.type !== "secp256k1") {
    throw new Error("Repo signing key must be a secp256k1 private multikey");
  }

  return Secp256k1Keypair.import(parsedKey.privateKeyBytes);
};

// Retry interval for events the sequencer has not acknowledged.
const OUTBOX_RETRY_MS = 30_000;
// Commit events are at most about 2 MB; stay well below the RPC size limit.
const OUTBOX_BATCH_SIZE = 8;

const toReadableStream = (chunks: AsyncIterable<Uint8Array>) => {
  const iterator = chunks[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async cancel() {
      await iterator.return?.();
    },
    async pull(controller) {
      const chunk = await iterator.next();
      if (chunk.done) {
        controller.close();
      } else {
        controller.enqueue(chunk.value);
      }
    },
  });
};

export class RepoDO extends DurableObject<RepoEnv> {
  private readonly core: CoreStorage;

  private keypair: Secp256k1Keypair | null = null;
  private repo: Repo | null = null;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: RepoEnv) {
    super(ctx, env);

    // initialize db and run migrations
    const { db, waitMigrations } = createDatabase(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      await Promise.resolve(waitMigrations());

      const signingKey = ctx.storage.kv.get<string>("signingKey");
      this.keypair = signingKey ? await importSigningKey(signingKey) : null;
    });

    this.core = new CoreStorage(db, ctx.storage);
  }

  async reserveRepo(did: string, signingKey: string): Promise<void> {
    const keypair = await importSigningKey(signingKey);
    const metadata = await this.core.getMetadata();
    if (metadata) {
      if (metadata.did !== did) {
        throw new Error(
          `Repository is reserved for ${metadata.did}, not ${did}`
        );
      }
      if (this.keypair && this.keypair.did() !== keypair.did()) {
        throw new Error("Repository uses a different signing key");
      }
      if (metadata.root_cid && metadata.rev) {
        if (!this.keypair) {
          throw new Error("Repository is missing its signing key");
        }
        await this.getRepo();
        return;
      }
    }

    const commit = await Repo.formatInitCommit(this.core, did, keypair);
    this.core.initializeRepo(did, signingKey, commit, metadata !== null);
    this.keypair = keypair;
    this.repo = await Repo.load(this.core, commit.cid);
  }

  async getRepo(): Promise<Repo> {
    if (this.repo) {
      return this.repo;
    }

    const root = await this.core.getRoot();
    if (!root) {
      throw new Error(
        "Repo is not properly initialized, try recreate with the same DID"
      );
    }

    if (!this.keypair) {
      throw new Error("Corrupted data, try recreate with the same DID");
    }

    // A cold read may overlap a commit; it must not overwrite the writer's cache.
    return Repo.load(this.core, root);
  }

  private async serializeWrite<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.writeTail;
    const gate = Promise.withResolvers<undefined>();
    this.writeTail = gate.promise;
    await previous;
    try {
      return await operation();
    } finally {
      // oxlint-disable-next-line unicorn/no-useless-undefined -- The undefined-valued resolver requires an argument.
      gate.resolve(undefined);
    }
  }

  rpcRegisterBlob(blob: BlobMetadata) {
    return this.serializeWrite(async () => {
      await this.getRepo();
      return this.core.registerBlob(blob);
    });
  }

  async rpcGetBlob(cid: string, publishedOnly = true) {
    await this.getRepo();
    return this.core.getBlob(cid, publishedOnly) ?? null;
  }

  async rpcListBlobs(options: {
    limit: number;
    cursor?: string | undefined;
    since?: string | undefined;
  }) {
    await this.getRepo();
    return this.core.listBlobs(options);
  }

  rpcApplyWrites(input: RepoWriteRequest): Promise<RepoWriteResponse> {
    // Blob registration shares this queue; R2 network I/O never holds it.
    return this.serializeWrite(async () => {
      const repo = await this.getRepo();
      if (!this.keypair) {
        throw new Error("Repository signing key is missing");
      }
      const prepared = await prepareCommit(repo, this.keypair, input, (cid) =>
        this.core.getBlob(cid)
      );
      if (prepared.error) {
        return { error: prepared.error, message: prepared.message };
      }
      if (prepared.commit) {
        const event = commitEvent(
          repo.did,
          prepared.commit,
          prepared.car,
          repo.commit.data,
          prepared.ops
        );
        await this.core.applyCommit(
          prepared.commit,
          prepared.references,
          event
        );
        // Never keep an old cached head if loading the committed repo fails.
        this.repo = null;
        // Arm redelivery before any other I/O can interrupt this write.
        await this.deliverEvents();
        this.repo = await Repo.load(this.core, prepared.commit.cid);
      }
      const committed = this.repo ?? repo;
      return {
        commit: { cid: committed.cid.toString(), rev: committed.commit.rev },
        results: prepared.results,
      };
    });
  }

  /** Emit the events that introduce a newly hosted account to relays. */
  rpcAnnounceAccount(handle: string): Promise<void> {
    return this.serializeWrite(async () => {
      const repo = await this.getRepo();
      this.core.enqueueEvents(await accountAnnouncementEvents(repo, handle));
      await this.deliverEvents();
    });
  }

  override async alarm(): Promise<void> {
    await this.serializeWrite(() => this.deliverEvents());
  }

  /**
   * Send queued events to the sequencer in order. The alarm is armed before
   * each attempt, so events committed before a crash or failed delivery are
   * retried; the write that queued them still succeeds.
   */
  private async deliverEvents(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + OUTBOX_RETRY_MS);
    try {
      const metadata = await this.core.getMetadata();
      if (metadata) {
        await this.flushOutbox(metadata.did);
      }
      await this.ctx.storage.deleteAlarm();
    } catch (error) {
      console.error("event delivery failed; retrying from the alarm", error);
    }
  }

  /** Each batch is acknowledged before the next, preserving commit order. */
  private async flushOutbox(did: string): Promise<void> {
    const events = this.core.getOutbox(OUTBOX_BATCH_SIZE);
    if (events.length === 0) {
      return;
    }
    const sequencer = this.env.SEQUENCER.getByName(SEQUENCER_NAME);
    this.core.deleteOutboxThrough(await sequencer.rpcSequence(did, events));
    await this.flushOutbox(did);
  }

  async rpcGetRepoStatus(): Promise<{
    did: string;
    head: string;
    rev: string;
  }> {
    const repo = await this.getRepo();

    return {
      did: repo.did,
      head: repo.cid.toString(),
      rev: repo.commit.rev,
    };
  }

  async rpcDescribeRepo(): Promise<{
    did: string;
    collections: string[];
    cid: string;
  }> {
    const repo = await this.getRepo();

    const seen = new Set<string>();
    for await (const leaf of repo.data.walkLeavesFrom("")) {
      seen.add(leaf.key.slice(0, leaf.key.indexOf("/")));
    }

    return {
      cid: repo.cid.toString(),
      collections: [...seen],
      did: repo.did,
    };
  }

  async rpcGetRecord(
    collection: string,
    rkey: string
  ): Promise<{ cid: string; record: Rpc.Serializable<unknown> } | null> {
    const repo = await this.getRepo();

    const dataKey = `${collection}/${rkey}`;
    const recordCid = await repo.data.get(dataKey);

    if (!recordCid) {
      // record not exist in current commit
      return null;
    }

    const record = await repo.storage.readRecord(recordCid);

    return {
      cid: recordCid.toString(),
      record: lexToJson(record),
    };
  }

  async rpcListRecords(options: {
    collection: string;
    limit: number;
    cursor: string | undefined;
    reverse: boolean;
  }): Promise<{
    cursor: string | undefined;
    records: { cid: string; uri: string; value: Rpc.Serializable<unknown> }[];
  }> {
    const repo = await this.getRepo();
    const { collection, limit, cursor, reverse } = options;
    const prefix = `${collection}/`;
    const boundary = cursor ? `${prefix}${cursor}` : undefined;
    let leaves: Leaf[];

    if (reverse) {
      leaves = await repo.data.list(
        limit + 1,
        boundary ?? prefix,
        `${prefix}\uFFFF`
      );
    } else {
      // The library has no reverse iterator. Retain only one page plus a lookahead
      // while scanning this collection; never decode records outside the page.
      leaves = [];
      for await (const leaf of repo.data.walkLeavesFrom(prefix)) {
        if (
          !leaf.key.startsWith(prefix) ||
          (boundary && leaf.key >= boundary)
        ) {
          break;
        }
        leaves.push(leaf);
        if (leaves.length > limit + 1) {
          leaves.shift();
        }
      }
      leaves.reverse();
    }

    const hasMore = leaves.length > limit;
    const page = leaves.slice(0, limit);
    const records = await Promise.all(
      page.map(async (leaf) => ({
        cid: leaf.value.toString(),
        uri: `at://${repo.did}/${leaf.key}`,
        value: lexToJson(await repo.storage.readRecord(leaf.value)),
      }))
    );
    return {
      cursor: hasMore ? page.at(-1)?.key.slice(prefix.length) : undefined,
      records,
    };
  }

  async rpcGetRecordProof(collection: string, rkey: string) {
    const repo = await this.getRepo();
    return toReadableStream(
      getRecords(repo.storage, repo.cid, [{ collection, rkey }])
    );
  }

  /**
   * Stream the current repository as a CAR, or only the blocks written after
   * `since`. Superseded blocks stay in storage, so the export walks the
   * current tree instead of the block table.
   */
  async rpcExportRepo(since?: string) {
    const repo = await this.getRepo();
    const root = {
      commit: repo.cid.toString(),
      data: repo.commit.data.toString(),
    };
    return toReadableStream(exportRepoCar(this.core, root, since));
  }

  rpcHealthCheck(): Promise<{ ok: true }> {
    this.core.healthCheck();
    return Promise.resolve({ ok: true });
  }
}
