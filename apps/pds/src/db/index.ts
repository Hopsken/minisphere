import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import * as schema from "./schema";

const relations = defineRelations(schema);

export type AccountDatabase = DrizzleD1Database<typeof relations>;

export const createAccountDatabase = (d1: D1Database): AccountDatabase =>
  drizzle(d1, { relations });
