import type { Operation } from "@atcute/did-plc";
import { defineRelationsPart, sql } from "drizzle-orm";
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
    encryptedRotationKey: text("encrypted_rotation_key"),
    operation: text("operation", { mode: "json" }).$type<Operation>(),
    rotationKeyIv: text("rotation_key_iv"),
    signingKey: text("signing_key"),
    status: text("status")
      .$type<AtprotoAccountStatus>()
      .notNull()
      .default("provisioning"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
    userId: text("user_id").primaryKey(),
    username: text("username").notNull().unique(),
  },
  (table) => [
    check(
      "atproto_account_status_check",
      sql`${table.status} IN ('provisioning', 'active')`
    ),
    check(
      "atproto_account_active_did_check",
      sql`${table.status} != 'active' OR ${table.did} IS NOT NULL`
    ),
    check(
      "atproto_account_identity_material_check",
      sql`(${table.did} IS NULL AND ${table.signingKey} IS NULL AND ${table.operation} IS NULL AND ${table.encryptedRotationKey} IS NULL AND ${table.rotationKeyIv} IS NULL) OR (${table.did} IS NOT NULL AND ${table.signingKey} IS NOT NULL AND ${table.operation} IS NOT NULL AND ${table.encryptedRotationKey} IS NOT NULL AND ${table.rotationKeyIv} IS NOT NULL)`
    ),
  ]
);

export const atprotoAccountRelations = defineRelationsPart(
  { atprotoAccount, user },
  (r) => ({
    atprotoAccount: {
      user: r.one.user({
        from: r.atprotoAccount.userId,
        to: r.user.id,
      }),
    },
  })
);
