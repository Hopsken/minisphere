import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const accountsTable = sqliteTable("accounts", {
  did: text().primaryKey(),
});

export const accountCreationOperationsTable = sqliteTable(
  "account_creation_operations",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    did: text().notNull().unique(),
    handle: text().notNull().unique(),
    operationId: text("operation_id").primaryKey(),
    status: text().$type<"active" | "provisioning">().notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    check(
      "account_creation_operation_status_check",
      sql`${table.status} IN ('provisioning', 'active')`
    ),
  ]
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
