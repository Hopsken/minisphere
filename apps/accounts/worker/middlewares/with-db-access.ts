import { createMiddleware } from "hono/factory";

import { createDatabase } from "../db";
import type { Database } from "../db";

export const withDBAccess = createMiddleware<{
  Bindings: Env;
  Variables: {
    database: Database;
  };
}>((ctx, next) => {
  if (!ctx.var.database) {
    const database = createDatabase(ctx.env.DB);
    ctx.set("database", database);
  }

  return next();
});
