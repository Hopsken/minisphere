import { isHandle } from "@atcute/lexicons/syntax";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { resolveConfig } from "../config";
import { withDBAccess } from "../middlewares/with-db-access";
import { UserRepository } from "../repositories/user-repository";
import { HandleService } from "../services/handle";

const resolverPath = "/xrpc/com.atproto.identity.resolveHandle";

export default new Hono<WorkerEnv>()
  .get("/.well-known/atproto-did", withDBAccess, async (ctx) => {
    const service = new HandleService(
      new UserRepository(ctx.var.database),
      resolveConfig(ctx.env).handleDomain
    );
    const did = await service.resolve(new URL(ctx.req.url).hostname);
    return did ? ctx.text(did) : ctx.notFound();
  })
  .use(resolverPath, cors())
  .get(resolverPath, withDBAccess, async (ctx) => {
    const handle = ctx.req.query("handle")?.toLowerCase();
    if (!handle || !isHandle(handle)) {
      return ctx.json(
        { error: "InvalidRequest", message: "A valid handle is required" },
        400
      );
    }
    const service = new HandleService(
      new UserRepository(ctx.var.database),
      resolveConfig(ctx.env).handleDomain
    );
    const did = await service.resolve(handle);
    if (!did) {
      return ctx.json(
        { error: "HandleNotFound", message: "Handle not found" },
        400
      );
    }
    return ctx.json({ did });
  });
