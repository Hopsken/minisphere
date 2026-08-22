import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accountsTable = sqliteTable(
  "accounts",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    did: text().primaryKey(),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    handle: text().notNull(),
    pdsOrigin: text("pds_origin").notNull(),
  },
  (table) => [uniqueIndex("accounts_handle_unique_idx").on(table.handle)]
);

export type Account = typeof accountsTable.$inferSelect;
