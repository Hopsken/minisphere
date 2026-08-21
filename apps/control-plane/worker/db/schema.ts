import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accountTypes = ["human", "agent"] as const;
export type AccountType = (typeof accountTypes)[number];

export const accountsTable = sqliteTable(
  "accounts",
  {
    accountType: text("account_type", { enum: accountTypes }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    did: text().primaryKey(),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    handle: text().notNull(),
    pdsOrigin: text("pds_origin").notNull(),
  },
  (table) => [uniqueIndex("accounts_handle_unique_idx").on(table.handle)]
);

export type Account = typeof accountsTable.$inferSelect;
