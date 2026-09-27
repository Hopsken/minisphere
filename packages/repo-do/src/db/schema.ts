import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import type { RepoEventType } from "../events";

export const metadataTable = sqliteTable("metadata", {
  id: integer().primaryKey().default(1),

  did: text().notNull(),
  rev: text().notNull(),
  root_cid: text().notNull(),
});

export const blocksTable = sqliteTable("blocks", {
  cid: text().primaryKey(),

  bytes: blob({ mode: "buffer" }).notNull(),
  rev: text().notNull(),
});

// Blocks a commit stopped referencing. Reclamation deletes those the current
// tree no longer reaches once `removedAt` is older than the grace period.
export const removedBlocksTable = sqliteTable(
  "removed_blocks",
  {
    cid: text().primaryKey(),
    removedAt: integer("removed_at").notNull(),
  },
  (table) => [index("removed_blocks_removed_at").on(table.removedAt)]
);

export const blobsTable = sqliteTable("blobs", {
  cid: text().primaryKey(),
  expiresAt: integer("expires_at").notNull(),
  key: text().notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer().notNull(),
});

export const recordBlobsTable = sqliteTable(
  "record_blobs",
  {
    cid: text()
      .notNull()
      .references(() => blobsTable.cid),
    path: text().notNull(),
    rev: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.path, table.cid] }),
    index("record_blobs_cid").on(table.cid),
  ]
);

// Committed events awaiting delivery to the PDS event sequencer, in commit order.
export const outboxTable = sqliteTable("outbox", {
  id: integer().primaryKey({ autoIncrement: true }),

  body: blob({ mode: "buffer" }).notNull(),
  type: text().$type<RepoEventType>().notNull(),
});
