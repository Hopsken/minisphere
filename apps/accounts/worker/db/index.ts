import { drizzle } from "drizzle-orm/d1";

import { authRelations } from "./schema";

export const createDatabase = (d1: D1Database) =>
  drizzle(d1, { relations: authRelations });

export type AccountsDatabase = ReturnType<typeof createDatabase>;
