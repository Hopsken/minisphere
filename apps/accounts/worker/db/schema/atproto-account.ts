import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./better-auth";

export type AtprotoAccountStatus = "active" | "provisioning";

export const atprotoAccount = sqliteTable(
  "atproto_account",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    did: text("did").unique(),
    operationId: text("operation_id").notNull().unique(),
    status: text("status")
      .$type<AtprotoAccountStatus>()
      .notNull()
      .default("provisioning"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id),
    username: text("username").notNull().unique(),
  },
  (table) => [
    check(
      "atproto_account_status_check",
      sql`${table.status} IN ('provisioning', 'active')`
    ),
    check(
      "atproto_account_active_did_check",
      sql`(${table.status} = 'active' AND ${table.did} IS NOT NULL) OR (${table.status} = 'provisioning' AND ${table.did} IS NULL)`
    ),
  ]
);
