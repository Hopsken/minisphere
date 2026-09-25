import { parsePrivateMultikey } from "@atcute/crypto";
import { Secp256k1Keypair } from "@atproto/crypto";
import { lexToJson } from "@atproto/lex-json";
import { getRecords, Repo, writeCarStream } from "@atproto/repo";
import type { CarBlock, Leaf } from "@atproto/repo";
import { DurableObject } from "cloudflare:workers";

import type { BlobMetadata } from "./blobs";
import { CoreStorage } from "./core";
import { createDatabase } from "./db";
import { prepareCommit } from "./writes";
import type { RepoWriteRequest, RepoWriteResponse } from "./writes";

const importSigningKey = (signingKey: string): Promise<Secp256k1Keypair> => {
  const parsedKey = parsePrivateMultikey(signingKey);
  if (parsedKey.type !== "secp256k1") {
    throw new Error("Repo signing key must be a secp256k1 private multikey");
  }

  return Secp256k1Keypair.import(parsedKey.privateKeyBytes);
};

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

const iterateRepoBlocks = async function* iterateRepoBlocks(
  repo: Repo,
  changed: Set<string> | null
): AsyncGenerator<CarBlock> {
  const commit = await repo.storage.getBytes(repo.cid);
  if (!commit) {
    throw new Error("Repository commit block is missing");
  }
  if (!changed || changed.has(repo.cid.toString())) {
    yield { bytes: commit, cid: repo.cid };
  }
  for await (const block of repo.data.carBlockStream()) {
    if (!changed || changed.has(block.cid.toString())) {
      yield block;
    }
  }
};

export class RepoDO extends DurableObject<Record<string, never>> {
  private readonly core: CoreStorage;

  private keypair: Secp256k1Keypair | null = null;
  private repo: Repo | null = null;
  private writeTail: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Record<string, never>) {
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
        await this.core.applyCommit(prepared.commit, prepared.references);
        // Never keep an old cached head if loading the committed repo fails.
        this.repo = null;
        this.repo = await Repo.load(this.core, prepared.commit.cid);
      }
      const committed = this.repo ?? repo;
      return {
        commit: { cid: committed.cid.toString(), rev: committed.commit.rev },
        results: prepared.results,
      };
    });
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
   * Stream the current repository as a CAR, or only its blocks written after
   * `since`. Superseded blocks stay in storage, so export walks the current
   * tree instead of the block table. Each commit rewrites every block that
   * becomes reachable with its rev, so a reachable block with an older rev has
   * stayed reachable since then and is already held by the consumer.
   */
  async rpcExportRepo(since?: string) {
    const repo = await this.getRepo();
    const changed =
      since === undefined ? null : this.core.getBlockCidsSince(since);
    return toReadableStream(
      writeCarStream(repo.cid, iterateRepoBlocks(repo, changed))
    );
  }

  rpcHealthCheck(): Promise<{ ok: true }> {
    this.core.healthCheck();
    return Promise.resolve({ ok: true });
  }
}
