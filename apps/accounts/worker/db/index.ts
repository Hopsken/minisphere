import { drizzle } from "drizzle-orm/d1";

import { authRelations } from "./schema/better-auth";
import { userRelations } from "./schema/user-relationships";

export const createDatabase = (d1: D1Database) =>
  drizzle(d1, { relations: { ...authRelations, ...userRelations } });

export type Database = ReturnType<typeof createDatabase>;
