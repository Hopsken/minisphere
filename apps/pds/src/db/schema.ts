import { sql } from "drizzle-orm";
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

export const signingKeyReservationsTable = sqliteTable(
  "signing_key_reservations",
  {
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    did: text("did").unique(),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    encryptionIv: text("encryption_iv").notNull(),
    signingKey: text("signing_key").primaryKey(),
  }
);
