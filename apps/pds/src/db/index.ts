import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import migrations from "../../drizzle/migrations";
import * as schema from "./schema";

const relations = defineRelations(schema);

export type Database = DrizzleSqliteDODatabase<typeof relations>;

export const createDatabase = (storage: DurableObjectStorage) => {
  const db = drizzle(storage, { relations });
  const waitMigrations = () => {
    const result = migrate(db, migrations);

    if (result === undefined) {
      return;
    }

    throw new Error(`[DB] migrations failed with code: ${result.exitCode}`);
  };

  return {
    db,
    waitMigrations,
  };
};
