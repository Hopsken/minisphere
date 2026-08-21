import { drizzle } from "drizzle-orm/d1";

export const createDatabase = (d1: D1Database) => drizzle(d1);

export type Database = ReturnType<typeof createDatabase>;
