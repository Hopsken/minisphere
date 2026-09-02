import { parsePrivateMultikey } from "@atcute/crypto";
import { Secp256k1Keypair } from "@atproto/crypto";
import { Repo } from "@atproto/repo";
import { DurableObject } from "cloudflare:workers";

import { CoreStorage } from "./core";
import { createDatabase } from "./db";
import { serializeRecord } from "./serialize-record";

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

    this.core = new CoreStorage(db);
  }

  async reserveRepo(did: string, signingKey: string): Promise<void> {
    const metadata = await this.core.getMetadata();
    if (metadata) {
      if (metadata.did !== did) {
        throw new Error(
          `Repository is reserved for ${metadata.did}, not ${did}`
        );
      }
      return;
    }

    const keypair = await importSigningKey(signingKey);
    this.ctx.storage.kv.put("signingKey", signingKey);
    this.keypair = keypair;

    await this.core.setDid(did);
    this.repo = await Repo.create(this.core, did, keypair);
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

    // NEXT: cache this
    const seen = new Set<string>();
    for await (const record of repo.walkRecords()) {
      if (!seen.has(record.collection)) {
        seen.add(record.collection);
      }
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

    const record = await repo.getRecord(collection, rkey);
    if (!record) {
      // record not exist in repo records, should be error
      throw new Error(`Missing data: ${collection}/${rkey}`);
    }

    return {
      cid: recordCid.toString(),
      record: serializeRecord(record),
    };
  }

  rpcHealthCheck(): Promise<{ ok: true }> {
    this.core.healthCheck();
    return Promise.resolve({ ok: true });
  }
}
