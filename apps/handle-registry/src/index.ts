import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono<{ Bindings: Env }>();

app
  .use(logger())
  .get("/", (ctx) => ctx.json({ name: "minisphere-handle-registry" }))
  .get("/.well-known/atproto-did", async (ctx) => {
    const handle = new URL(ctx.req.url).hostname.toLowerCase();
    const did = await ctx.env.Accounts.resolveHandle(handle);

    if (!did) {
      return ctx.notFound();
    }

    return ctx.text(did);
  })
  .get("/_health", (ctx) => ctx.json({ status: "ok" }))
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  .onError((error, ctx) => {
    console.error(error);
    return ctx.text("Internal Server Error", 500);
  });

export default {
  fetch: app.fetch,
};
