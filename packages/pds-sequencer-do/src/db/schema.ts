import {
  blob,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Encoded subscribeRepos frames retained for cursor replay.
export const eventsTable = sqliteTable(
  "events",
  {
    seq: integer().primaryKey(),

    createdAt: integer("created_at").notNull(),
    frame: blob({ mode: "buffer" }).notNull(),
  },
  (table) => [index("events_created_at").on(table.createdAt)]
);

// The last RepoDO outbox ID accepted per repository, so redelivery is idempotent.
export const repoSourcesTable = sqliteTable("repo_sources", {
  did: text().primaryKey(),

  lastEventId: integer("last_event_id").notNull(),
});
