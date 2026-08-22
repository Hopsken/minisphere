import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "./schema";

const relations = defineRelations(schema);

export type PdsDatabase = DrizzleD1Database<typeof relations>;

export const createPdsDatabase = (d1: D1Database): PdsDatabase =>
  drizzle(d1, { relations });
