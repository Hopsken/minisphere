import { isHandle } from "@atcute/lexicons/syntax";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono<{ Bindings: Env }>();

app
  .use(logger())
  .use("/xrpc/*", cors())
  .get("/", (ctx) => ctx.json({ name: "minisphere-handle-registry" }))
  .get("/.well-known/atproto-did", async (ctx) => {
    const handle = new URL(ctx.req.url).hostname.toLowerCase();
    const did = await ctx.env.Accounts.resolveHandle(handle);

    if (!did) {
      return ctx.notFound();
    }

    return ctx.text(did);
  })
  .get("/xrpc/com.atproto.identity.resolveHandle", async (ctx) => {
    const handle = ctx.req.query("handle")?.toLowerCase();
    if (!handle || !isHandle(handle)) {
      return ctx.json(
        { error: "InvalidRequest", message: "A valid handle is required" },
        400
      );
    }

    const did = await ctx.env.Accounts.resolveHandle(handle);
    if (!did) {
      return ctx.json(
        { error: "HandleNotFound", message: "Handle not found" },
        400
      );
    }

    return ctx.json({ did });
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
