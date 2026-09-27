import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./better-auth";

export const appPassword = sqliteTable(
  "app_password",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    // SHA-256 of a generated 80-bit secret; the secret is shown only once.
    passwordHash: text("password_hash").notNull(),
    privileged: integer("privileged", { mode: "boolean" }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("app_password_user_name_idx").on(table.userId, table.name),
    uniqueIndex("app_password_hash_idx").on(table.passwordHash),
  ]
);

export const appPasswordRefreshToken = sqliteTable(
  "app_password_refresh_token",
  {
    appPasswordId: text("app_password_id")
      .notNull()
      .references(() => appPassword.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    id: text("id").primaryKey(),
    // Set when the token is rotated; the old token then expires after a grace period.
    nextId: text("next_id"),
  },
  (table) => [
    index("app_password_refresh_token_app_password_idx").on(
      table.appPasswordId
    ),
  ]
);
