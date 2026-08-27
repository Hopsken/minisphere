import { sql } from "drizzle-orm/sql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// list of dids managed by control plane
export const accountsTable = sqliteTable("accounts", {
  did: text().primaryKey(),

  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(CURRENT_TIMESTAMP)`)
    .notNull(),
});

export type AccountRow = typeof accountsTable.$inferSelect;
