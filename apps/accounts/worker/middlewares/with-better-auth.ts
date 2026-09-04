import { createMiddleware } from "hono/factory";

import { getConfig } from "../config";
import type { Database } from "../db";
import { createAuth } from "../lib/better-auth";

export const withBetterAuth = createMiddleware<{
  Bindings: Env;
  Variables: {
    auth: ReturnType<typeof createAuth>;
    database: Database;
  };
}>((ctx, next) => {
  if (!ctx.var.auth) {
    const auth = createAuth(getConfig(), ctx.var.database);
    ctx.set("auth", auth);
  }

  return next();
});
