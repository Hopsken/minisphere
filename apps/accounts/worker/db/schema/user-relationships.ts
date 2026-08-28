import { defineRelationsPart } from "drizzle-orm";
import { sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

import { user } from "./better-auth";

export const usersToUsers = sqliteTable(
  "user-relationships",
  {
    sourceUserId: text("source_user_id")
      .notNull()
      .references(() => user.id),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => user.id),
  },
  (table) => [primaryKey({ columns: [table.sourceUserId, table.targetUserId] })]
);

export const userRelations = defineRelationsPart(
  {
    user,
    usersToUsers,
  },
  (r) => ({
    user: {
      descendants: r.many.user({
        from: r.user.id.through(r.usersToUsers.sourceUserId),
        to: r.user.id.through(r.usersToUsers.targetUserId),
      }),

      parents: r.many.user(),
    },
  })
);
