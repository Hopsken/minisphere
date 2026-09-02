import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accountsTable = sqliteTable("accounts", {
  did: text().primaryKey(),
});

export const refreshTokensTable = sqliteTable(
  "refresh_tokens",
  {
    did: text()
      .notNull()
      .references(() => accountsTable.did, { onDelete: "cascade" }),
    expires_at: integer().notNull(),
    jti: text().primaryKey(),
  },
  (table) => [index("refresh_tokens_did_idx").on(table.did)]
);
