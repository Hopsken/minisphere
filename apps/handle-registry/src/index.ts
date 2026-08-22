import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { createDatabase } from "./db";
import type { Database } from "./db";

const app = new Hono<{
  Bindings: Env;
  Variables: {
    db: Database;
  };
}>();

app.use(logger()).use((ctx, next) => {
  ctx.set("db", createDatabase(ctx.env.DB));
  return next();
});

app.get("/", (ctx) => ctx.json({ name: "minisphere-handle-registry" }));

app.get("/_health", async (ctx) => {
  try {
    await ctx.var.db.run(sql`SELECT 1`);
    return ctx.json({ status: "ok" });
  } catch (error) {
    console.error("failed health check", error);
    throw new HTTPException(503, { message: "service unavailable" });
  }
});

// oxlint-disable-next-line promise/prefer-await-to-callbacks
app.onError((error, ctx) => {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  console.error(error);
  return ctx.text("Internal Server Error", 500);
});

export default app;
