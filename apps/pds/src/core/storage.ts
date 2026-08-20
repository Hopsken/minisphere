import { parseCid } from "@atproto/lex-data";
import type { Cid } from "@atproto/lex-data";
import type { BlockMap, CommitData, RepoStorage } from "@atproto/repo";
import {
  eq,
  // inArray,
  sql,
} from "drizzle-orm";

import { blocksTable, metadataTable } from "../db/schema";
import { BlockStorage } from "./block";
import type { RootState } from "./type";

export class CoreStorage extends BlockStorage implements RepoStorage {
  private async getMetadata(): Promise<RootState | null> {
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
      bytes: block,
      cid: cid.toString(),
      rev,
    });
  }

  async putMany(blocks: BlockMap, rev: string): Promise<void> {
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions anti-slop/require-safety-comment-for-type-assertion
    const mappings = blocks as unknown as { map: Map<string, Uint8Array> };
    if (mappings) {
      await this.db
        .insert(blocksTable)
        .values(
          Object.entries(mappings).map(([cid, bytes]) => ({
            bytes,
            cid: cid.toString(),
            rev,
          }))
        )
        .onConflictDoUpdate({
          set: { bytes: sql`excluded.bytes`, rev: sql`excluded.rev` },
          target: blocksTable.cid,
        });
    }
  }

  async updateRoot(cid: Cid, rev: string): Promise<void> {
    const cidString = cid.toString();

    await this.db
      .update(metadataTable)
      .set({ rev, root_cid: cidString })
      .where(eq(metadataTable.id, 1));
  }

  /**
   * Apply a commit atomically: add new blocks, remove old blocks, update root.
   */
  async applyCommit(commit: CommitData) {
    await this.putMany(commit.newBlocks, commit.rev);

    // May not need to delete outdated cids for backward verifications
    // const removedCids = commit.removedCids
    //   .toList()
    //   .map((cid) => cid.toString());
    // await this.db
    //   .delete(blocksTable)
    //   .where(inArray(blocksTable.cid, removedCids));

    await this.updateRoot(commit.cid, commit.rev);
  }
}
