import { drizzle } from "drizzle-orm/durable-sqlite";
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import migrations from "../../migrations/migrations";

export type Database = DrizzleSqliteDODatabase;

export const createDatabase = (storage: DurableObjectStorage) => {
  const db = drizzle(storage);
  const waitMigrations = () => {
    const result = migrate(db, migrations);
    if (result !== undefined) {
      throw new Error(`[DB] migrations failed with code: ${result.exitCode}`);
    }
  };
  return { db, waitMigrations };
};
