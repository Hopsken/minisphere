import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { createDatabase } from "./db";
import { withBetterAuth } from "./middlewares/with-better-auth";
import { withDBAccess } from "./middlewares/with-db-access";
import { UserRepository } from "./repositories/user-repository";
import api from "./routes";

declare global {
  interface WorkerEnv {
    Bindings: Env;
  }
}

const app = new Hono<WorkerEnv>().use(logger());

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
  .route("/api", api)
  .notFound((c) =>
    c.json({ error: "NotFound", message: "API endpoint not found" }, 404)
  )
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  .onError((error, c) => {
    console.error(error);
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

export class AccountsEntrypoint extends WorkerEntrypoint<Env> {
  async resolveHandle(handle: string): Promise<string | null> {
    const normalizedHandle = handle.toLowerCase();
    const handleSuffix = `.${this.env.PUBLIC_HANDLE_DOMAIN.toLowerCase()}`;

    if (!normalizedHandle.endsWith(handleSuffix)) {
      return null;
    }

    const username = normalizedHandle.slice(0, -handleSuffix.length);
    if (!username || username.includes(".")) {
      return null;
    }

    const users = new UserRepository(createDatabase(this.env.DB));
    const did = await users.findDidByUsername(username);
    return did;
  }
}
