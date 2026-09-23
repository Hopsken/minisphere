import { parsePrivateMultikey } from "@atcute/crypto";
import { Secp256k1Keypair } from "@atproto/crypto";
import { lexToJson } from "@atproto/lex-json";
import { getRecords, Repo } from "@atproto/repo";
import type { Leaf } from "@atproto/repo";
import { DurableObject } from "cloudflare:workers";

import { CoreStorage } from "./core";
import { createDatabase } from "./db";

const importSigningKey = (signingKey: string): Promise<Secp256k1Keypair> => {
  const parsedKey = parsePrivateMultikey(signingKey);
  if (parsedKey.type !== "secp256k1") {
    throw new Error("Repo signing key must be a secp256k1 private multikey");
  }

  return Secp256k1Keypair.import(parsedKey.privateKeyBytes);
};

export class RepoDO extends DurableObject<Record<string, never>> {
  private readonly core: CoreStorage;

  private keypair: Secp256k1Keypair | null = null;
  private repo: Repo | null = null;

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

    this.repo = await Repo.load(this.core, root);
    return this.repo;
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
    const chunks = getRecords(repo.storage, repo.cid, [{ collection, rkey }]);
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
  }

  rpcHealthCheck(): Promise<{ ok: true }> {
    this.core.healthCheck();
    return Promise.resolve({ ok: true });
  }
}
