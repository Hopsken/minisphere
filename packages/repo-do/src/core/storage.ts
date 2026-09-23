import { Buffer } from "node:buffer";

import { parseCid } from "@atproto/lex-data";
import type { Cid } from "@atproto/lex-data";
import type { BlockMap, CommitData, RepoStorage } from "@atproto/repo";
import {
  eq,
  // inArray,
  sql,
} from "drizzle-orm";

import type { Database } from "../db";
import { blocksTable, metadataTable } from "../db/schema";
import { BlockStorage } from "./block";
import type { RootState } from "./type";

export class CoreStorage extends BlockStorage implements RepoStorage {
  private readonly storage: DurableObjectStorage;

  constructor(db: Database, storage: DurableObjectStorage) {
    super(db);
    this.storage = storage;
  }

  async getMetadata(): Promise<RootState | null> {
    const row = await this.db.query.metadataTable.findFirst();
    return row ?? null;
  }

  async getRoot(): Promise<Cid | null> {
    const root = await this.getMetadata();
    return root ? parseCid(root.root_cid) : null;
  }

  async getRev(): Promise<string | null> {
    const root = await this.getMetadata();
    return root?.rev ?? null;
  }

  async putBlock(cid: Cid, block: Uint8Array, rev: string): Promise<void> {
    await this.db.insert(blocksTable).values({
      bytes: Buffer.from(block),
      cid: cid.toString(),
      rev,
    });
  }

  putMany(blocks: BlockMap, rev: string): Promise<void> {
    if (blocks.size === 0) {
      return Promise.resolve();
    }

    const rows = blocks.entries().map(({ bytes, cid }) => ({
      bytes: Buffer.from(bytes),
      cid: cid.toString(),
      rev,
    }));
    this.db.transaction((transaction) => {
      for (let offset = 0; offset < rows.length; offset += 25) {
        transaction
          .insert(blocksTable)
          .values(rows.slice(offset, offset + 25))
          .onConflictDoUpdate({
            set: { bytes: sql`excluded.bytes`, rev: sql`excluded.rev` },
            target: blocksTable.cid,
          })
          .run();
      }
    });
    return Promise.resolve();
  }

  async updateRoot(cid: Cid, rev: string): Promise<void> {
    const cidString = cid.toString();

    await this.db
      .update(metadataTable)
      .set({ rev, root_cid: cidString })
      .where(eq(metadataTable.id, 1));
  }

  initializeRepo(
    did: string,
    signingKey: string,
    commit: CommitData,
    replaceIncomplete: boolean
  ): void {
    const blocks = commit.newBlocks.entries().map(({ bytes, cid }) => ({
      bytes: Buffer.from(bytes),
      cid: cid.toString(),
      rev: commit.rev,
    }));

    this.db.transaction((transaction) => {
      if (replaceIncomplete) {
        transaction.delete(blocksTable).run();
        transaction.delete(metadataTable).run();
      }
      for (let offset = 0; offset < blocks.length; offset += 25) {
        transaction
          .insert(blocksTable)
          .values(blocks.slice(offset, offset + 25))
          .run();
      }
      transaction
        .insert(metadataTable)
        .values({
          did,
          id: 1,
          rev: commit.rev,
          root_cid: commit.cid.toString(),
        })
        .run();
      this.storage.kv.put("signingKey", signingKey);
    });
  }

  /**
   * Apply a commit atomically: add new blocks, remove old blocks, update root.
   */
  applyCommit(commit: CommitData): Promise<void> {
    const blocks = commit.newBlocks.entries().map(({ bytes, cid }) => ({
      bytes: Buffer.from(bytes),
      cid: cid.toString(),
      rev: commit.rev,
    }));

    this.db.transaction((transaction) => {
      // Three bindings per row; stay below Workers SQLite's variable limit.
      for (let offset = 0; offset < blocks.length; offset += 25) {
        transaction
          .insert(blocksTable)
          .values(blocks.slice(offset, offset + 25))
          .onConflictDoUpdate({
            set: { bytes: sql`excluded.bytes`, rev: sql`excluded.rev` },
            target: blocksTable.cid,
          })
          .run();
      }

      // May not need to delete outdated cids for backward verifications
      // const removedCids = commit.removedCids
      //   .toList()
      //   .map((cid) => cid.toString());

      transaction
        .update(metadataTable)
        .set({ rev: commit.rev, root_cid: commit.cid.toString() })
        .where(eq(metadataTable.id, 1))
        .run();
    });
    return Promise.resolve();
  }

  healthCheck() {
    this.db.run(sql`SELECT 1`);
    return { ok: true };
  }
}
