import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accountsTable = sqliteTable("accounts", {
  did: text().primaryKey(),
});

export const accountInvitationsTable = sqliteTable(
  "account_invitations",
  {
    code: text().primaryKey(),
    expires_at: integer().notNull(),
  },
  (table) => [index("account_invitations_expires_at_idx").on(table.expires_at)]
);

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
