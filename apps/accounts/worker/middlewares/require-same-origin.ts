import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { resolveConfig } from "../config";

/** Rejects cookie-authenticated writes that do not come from the Accounts SPA. */
export const requireSameOrigin = createMiddleware((ctx, next) => {
  if (
    ctx.req.header("Origin") !== resolveConfig().accountsOrigin ||
    (ctx.req.header("Sec-Fetch-Site") !== undefined &&
      ctx.req.header("Sec-Fetch-Site") !== "same-origin")
  ) {
    throw new HTTPException(403, {
      message: "Same-origin request required",
    });
  }
  return next();
});
