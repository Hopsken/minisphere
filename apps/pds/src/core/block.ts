import { parseCidSafe } from "@atproto/lex-data";
import type { Cid } from "@atproto/lex-data";
import { ReadableBlockstore, BlockMap } from "@atproto/repo";

import type { Database } from "../db";

export class BlockStorage extends ReadableBlockstore {
  protected readonly db: Database;

  constructor(db: Database) {
    super();
    this.db = db;
  }

  async getBytes(cid: Cid): Promise<Uint8Array | null> {
    const cidString = cid.toString();
    const row = await this.db.query.blocksTable.findFirst({
      where: { cid: cidString },
    });

    if (!row) {
      return null;
    }

    return new Uint8Array(row.bytes);
  }

  async has(cid: Cid): Promise<boolean> {
    const cidString = cid.toString();
    const row = await this.db.query.blocksTable.findFirst({
      columns: { cid: true },
      where: { cid: cidString },
    });
    return !!row;
  }

  async getBlocks(cids: Cid[]): Promise<{ blocks: BlockMap; missing: Cid[] }> {
    const cidsInString = cids.map((cid) => cid.toString());

    const rows = await this.db.query.blocksTable.findMany({
      where: { cid: { in: cidsInString } },
    });

    const blocksMap = new BlockMap();

    for (const row of rows) {
      const safeCid = parseCidSafe(row.cid);
      // this should never happens since cid string is from validated input
      if (!safeCid) {
        continue;
      }
      blocksMap.set(safeCid, new Uint8Array(row.bytes));
    }

    const missing = [];
    for (const cid of cids) {
      if (blocksMap.has(cid)) {
        continue;
      }
      missing.push(cid);
    }

    return {
      blocks: blocksMap,
      missing,
    };
  }
}
