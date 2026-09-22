import { sql } from "drizzle-orm";
import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const oauthSigningKey = sqliteTable(
  "oauth_signing_key",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`),
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    encryptionIv: text("encryption_iv").notNull(),
    kid: text("kid").primaryKey(),
    publicX: text("public_x").notNull(),
    publicY: text("public_y").notNull(),
    status: text("status", {
      enum: ["current", "retired", "disabled"],
    }).notNull(),
  },
  (table) => [
    check(
      "oauth_signing_key_status_check",
      sql`${table.status} IN ('current', 'retired', 'disabled')`
    ),
    uniqueIndex("oauth_signing_key_one_current")
      .on(table.status)
      .where(sql`${table.status} = 'current'`),
  ]
);
