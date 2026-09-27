import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { withResourceAuth } from "../../middlewares/with-resource-auth";
import { withServiceProxy } from "../../middlewares/with-service-proxy";
import { proxyTarget } from "../../services/service-proxy";

const methodNotImplemented = () =>
  new HTTPException(501, {
    res: Response.json(
      { error: "MethodNotImplemented", message: "Method not implemented" },
      { status: 501 }
    ),
  });

/**
 * Sends methods this PDS does not implement to the service named by
 * `atproto-proxy`, or to the Bluesky AppView and chat services by namespace.
 * Register it after every local route.
 */
export default new Hono<{ Bindings: Env }>().on(
  ["GET", "HEAD", "POST"],
  "/:lxm{[a-z][a-z0-9-]*(?:\\.[a-zA-Z0-9-]+){2,}}",
  (ctx, next) => {
    if (!proxyTarget(ctx.req.param("lxm"), ctx.req.header("atproto-proxy"))) {
      throw methodNotImplemented();
    }
    return next();
  },
  withResourceAuth,
  withServiceProxy,
  (ctx) => {
    const lxm = ctx.req.param("lxm");
    const target = proxyTarget(lxm, ctx.req.header("atproto-proxy"));
    if (!target) {
      throw methodNotImplemented();
    }
    return ctx.var.serviceProxy.forward(ctx.req.raw, lxm, target);
  }
);
