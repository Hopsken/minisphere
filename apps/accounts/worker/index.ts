import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { resolveConfig } from "./config";
import { withBetterAuth } from "./middlewares/with-better-auth";
import { withDBAccess } from "./middlewares/with-db-access";
import { UsernameUnavailableError } from "./repositories/username-unavailable-error";
import api from "./routes";
import handles from "./routes/handles";

declare global {
  interface WorkerEnv {
    Bindings: Env;
  }
}

const app = new Hono<WorkerEnv>().use(logger());

app.get("/health", (ctx) => {
  ctx.header("Cache-Control", "no-store");
  resolveConfig();
  return ctx.json({ status: "ok" });
});

if (import.meta.env.DEV) {
  const { default: dev } = await import("./routes/dev");
  app.route("/__dev", dev);
}

app
  .use("/.well-known/oauth-authorization-server", withDBAccess, withBetterAuth)
  .all("/.well-known/oauth-authorization-server", (ctx) =>
    ctx.var.auth.handler(ctx.req.raw)
  )
  .use("/oauth/*", withDBAccess, withBetterAuth)
  .all("/oauth/*", (ctx) => ctx.var.auth.handler(ctx.req.raw));

app
  .route("/", handles)
  .route("/api", api)
  .notFound((c) =>
    c.json({ error: "NotFound", message: "API endpoint not found" }, 404)
  )
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  .onError((error, c) => {
    console.error(error);
    if (error instanceof UsernameUnavailableError) {
      return c.json({ message: error.message, status: 409 }, 409);
    }
    if (error instanceof HTTPException) {
      const response = error.getResponse();
      return c.json(
        {
          message: error.message,
          status: response.status,
        },
        error.status
      );
    }

    return c.json(
      { error: "InternalServerError", message: "Internal server error" },
      500
    );
  });

export default app;
export type { ApiType } from "./routes";
