import { drizzle } from "drizzle-orm/d1";

import { authRelations } from "./schema/better-auth";

export const createDatabase = (d1: D1Database) =>
  drizzle(d1, { relations: authRelations });

export type Database = ReturnType<typeof createDatabase>;
