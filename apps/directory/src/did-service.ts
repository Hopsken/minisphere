import { cidForLex } from "@atproto/lex-cbor";
import type { CompatibleOpOrTombstone, IndexedOperation } from "@did-plc/lib";
import * as plc from "@did-plc/lib";
import { and, eq, inArray, sql } from "drizzle-orm";
import { CID } from "multiformats/cid";

import type { Database } from "./db";
import { dids, operations } from "./db/schema";

export interface IDidService {
  validateAndAddOp: (
    did: string,
    proposed: CompatibleOpOrTombstone,
    proposedDate: Date
  ) => Promise<void>;

  opsForDid: (did: string) => Promise<CompatibleOpOrTombstone[]>;

  indexedOpsForDid: (
    did: string,
    includeNullified?: boolean
  ) => Promise<IndexedOperation[]>;

  lastOpForDid: (did: string) => Promise<CompatibleOpOrTombstone | null>;
}

export class DidService implements IDidService {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async validateAndAddOp(
    did: string,
    proposed: CompatibleOpOrTombstone,
    proposedDate: Date
  ): Promise<void> {
    const ops = await this.indexedOpsForDid(did);

    // throws if invalid
    const { nullified, prev } = await plc.assureValidNextOp(did, ops, proposed);
    const nullifiedStrs = nullified.map((cid) => cid.toString());
    const prevStr = prev?.toString() ?? null;

    // do not enforce rate limits on recovery operations to prevent DDOS by a bad actor
    // if (nullified.length === 0) {
    //   enforceOpsRateLimit(ops)
    // }

    const cid = await cidForLex(proposed);

    await this.db.batch([
      // upsert dids table if not existed before
      this.db.insert(dids).values({ did }).onConflictDoNothing(),

      // mark all items nullified by this operation if any
      nullifiedStrs.length > 0
        ? this.db
            .update(operations)
            .set({ nullified: true })
            .where(
              and(
                eq(operations.did, did),
                inArray(operations.cid, nullifiedStrs)
              )
            )
        : this.db.run(sql`SELECT 1`),

      // Check the canonical head in the INSERT to avoid a read/write race.
      // SQLite's IS is null-safe, so an empty history plus a null prev permits
      // the first operation. A stale prev writes NULL to the NOT NULL column,
      // making D1 roll back this operation and the nullification updates above.
      this.db.insert(operations).values({
        cid: cid.toString(),
        createdAt: proposedDate,
        did,
        nullified: sql`
          CASE WHEN (
            SELECT ${operations.cid}
            FROM ${operations}
            WHERE ${operations.did} = ${did}
              AND ${operations.nullified} = 0
            ORDER BY ${operations._id} DESC
            LIMIT 1
          ) IS ${prevStr} THEN 0 ELSE NULL END
        `,
        operation: proposed,
      }),
    ]);
  }

  async opsForDid(did: string): Promise<CompatibleOpOrTombstone[]> {
    const ops = await this.indexedOpsForDid(did);
    return ops.map((op) => op.operation);
  }

  async indexedOpsForDid(
    did: string,
    includeNullified = false
  ): Promise<IndexedOperation[]> {
    const rows = await this.db.query.operations.findMany({
      orderBy: { _id: "asc" },
      where: { did, nullified: includeNullified ? undefined : false },
    });

    return rows.map((row) => ({
      cid: CID.parse(row.cid),
      createdAt: row.createdAt,
      did: row.did,
      nullified: row.nullified,
      operation: row.operation,
    }));
  }

  async lastOpForDid(did: string): Promise<CompatibleOpOrTombstone | null> {
    const row = await this.db.query.operations.findFirst({
      orderBy: { _id: "desc" },
      where: { did, nullified: false },
    });
    return row?.operation ?? null;
  }
}
