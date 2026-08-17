import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { relations } from "./relations";

export type Database = DrizzleD1Database<typeof relations>;

export const createDatabase = (d1: D1Database) => drizzle(d1, { relations });
