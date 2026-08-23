import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "./schema";

const relations = defineRelations(schema);

export type Database = DrizzleD1Database<typeof relations>;

export const createDatabase = (d1: D1Database): Database =>
  drizzle(d1, { relations });
