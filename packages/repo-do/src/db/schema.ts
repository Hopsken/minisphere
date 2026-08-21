import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
