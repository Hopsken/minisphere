import { Buffer } from "node:buffer";

import { parseCid } from "@atproto/lex-data";
import type { Cid } from "@atproto/lex-data";
import type { BlockMap, CommitData, RepoStorage } from "@atproto/repo";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

import type { BlobMetadata, RecordBlobChanges } from "../blobs";
import type { Database } from "../db";
import {
  blobsTable,
  blocksTable,
  metadataTable,
  recordBlobsTable,
} from "../db/schema";
import { BlockStorage } from "./block";
import type { RootState } from "./type";

export interface StoredBlock {
  bytes: Uint8Array;
  rev: string;
}

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
  applyCommit(
    commit: CommitData,
    references: RecordBlobChanges = new Map()
  ): Promise<void> {
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

      // Publish only the final reference set, never intermediate batch states.
      const previous = new Set<string>();
      for (const [path, cids] of references) {
        for (const row of transaction
          .select()
          .from(recordBlobsTable)
          .where(eq(recordBlobsTable.path, path))
          .all()) {
          previous.add(row.cid);
        }
        transaction
          .delete(recordBlobsTable)
          .where(eq(recordBlobsTable.path, path))
          .run();
        for (const cid of cids) {
          transaction
            .insert(recordBlobsTable)
            .values({ cid, path, rev: commit.rev })
            .run();
        }
      }
      for (const cid of previous) {
        const referenced = transaction
          .select()
          .from(recordBlobsTable)
          .where(eq(recordBlobsTable.cid, cid))
          .limit(1)
          .get();
        if (!referenced) {
          // Physical R2 reclamation is deferred. Removing metadata prevents an
          // old descriptor from resurrecting the blob without another upload.
          transaction.delete(blobsTable).where(eq(blobsTable.cid, cid)).run();
        }
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

  getBlob(cid: string, publishedOnly = false): BlobMetadata | undefined {
    const blob = this.db
      .select()
      .from(blobsTable)
      .where(eq(blobsTable.cid, cid))
      .get();
    if (!blob) {
      return undefined;
    }
    const referenced = this.db
      .select()
      .from(recordBlobsTable)
      .where(eq(recordBlobsTable.cid, cid))
      .limit(1)
      .get();
    return referenced || (!publishedOnly && blob.expiresAt > Date.now())
      ? blob
      : undefined;
  }

  registerBlob(blob: BlobMetadata): BlobMetadata {
    const existing = this.getBlob(blob.cid);
    const selected = existing ?? blob;
    this.db
      .insert(blobsTable)
      .values({ ...selected, expiresAt: Date.now() + 24 * 60 * 60 * 1000 })
      .onConflictDoUpdate({
        set: { ...selected, expiresAt: Date.now() + 24 * 60 * 60 * 1000 },
        target: blobsTable.cid,
      })
      .run();
    return selected;
  }

  listBlobs(options: {
    limit: number;
    cursor?: string | undefined;
    since?: string | undefined;
  }) {
    const rows = this.db
      .selectDistinct({ cid: recordBlobsTable.cid })
      .from(recordBlobsTable)
      .where(
        and(
          options.cursor ? gt(recordBlobsTable.cid, options.cursor) : undefined,
          options.since ? gt(recordBlobsTable.rev, options.since) : undefined
        )
      )
      .orderBy(recordBlobsTable.cid)
      .limit(options.limit + 1)
      .all();
    const cids = rows.slice(0, options.limit).map((row) => row.cid);
    return {
      cids,
      cursor: rows.length > options.limit ? cids.at(-1) : undefined,
    };
  }

  /** Read blocks with the revision that last made them reachable. */
  getStoredBlocks(cids: readonly string[]): Map<string, StoredBlock> {
    // Stay within the 100 bound parameters Durable Object SQLite allows per query.
    const chunks = Array.from({ length: Math.ceil(cids.length / 90) }, (_, i) =>
      cids.slice(i * 90, i * 90 + 90)
    );
    return new Map(
      chunks
        .flatMap((chunk) =>
          this.db
            .select()
            .from(blocksTable)
            .where(inArray(blocksTable.cid, chunk))
            .all()
        )
        .map((row) => [
          row.cid,
          { bytes: new Uint8Array(row.bytes), rev: row.rev },
        ])
    );
  }

  healthCheck() {
    this.db.run(sql`SELECT 1`);
    return { ok: true };
  }
}
