import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { createDatabase } from "./db";
import type { Database } from "./db";
import { Registry } from "./registry";

const app = new Hono<{
  Bindings: Env;
  Variables: { db: Database };
}>();

app
  .use(logger())
  .use((ctx, next) => {
    const db = createDatabase(ctx.env.DB);
    ctx.set("db", db);
    return next();
  })
  .get("/", (ctx) => ctx.json({ name: "minisphere-handle-registry" }))
  .get("/.well-known/atproto-did", async (ctx) => {
    const handle = new URL(ctx.req.url).hostname.toLowerCase();

    const db = ctx.get("db");
    const registry = new Registry(db);

    const did = await registry.getDidByHandle(handle);

    if (!did) {
      return ctx.notFound();
    }

    return ctx.text(did);
  })
  .get("/_health", async (ctx) => {
    try {
      await ctx.var.db.run(sql`SELECT 1`);
      return ctx.json({ status: "ok" });
    } catch (error) {
      console.error("failed health check", error);
      throw new HTTPException(503, { message: "service unavailable" });
    }
  })
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  .onError((error, ctx) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }

    console.error(error);
    return ctx.text("Internal Server Error", 500);
  });

export default app;

export { HandleRegistryEntrypoint } from "./worker-entrypoint";
