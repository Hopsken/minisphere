import { createMiddleware } from "hono/factory";

import type { Config } from "../config";
import type { Database } from "../db";
import { createAuth } from "../lib/better-auth";

export const withBetterAuth = createMiddleware<{
  Bindings: Env;
  Variables: {
    auth: ReturnType<typeof createAuth>;
    config: Config;
    database: Database;
  };
}>((ctx, next) => {
  if (!ctx.var.auth) {
    const auth = createAuth(ctx.var.config, ctx.var.database);
    ctx.set("auth", auth);
  }

  return next();
});
