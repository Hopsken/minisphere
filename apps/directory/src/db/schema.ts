import type { CompatibleOpOrTombstone } from "@did-plc/lib";
import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

export const dids = sqliteTable("dids", {
  did: text().primaryKey(),
});

export const operations = sqliteTable(
  "operations",
  {
    _id: integer().primaryKey({ autoIncrement: true }),

    did: text().notNull(),

    operation: text({ mode: "json" })
      .notNull()
      .$type<CompatibleOpOrTombstone>(),

    cid: text().notNull(),

    nullified: integer({ mode: "boolean" }).notNull().default(false),

    createdAt: integer({ mode: "timestamp_ms" })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("operations_did_cid_unique_idx").on(table.did, table.cid),
    index("operations_did_createdat_idx").on(table.did, table.createdAt),
  ]
);
