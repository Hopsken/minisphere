import { Hono } from "hono";

import { withBetterAuth } from "../middlewares/with-better-auth";
import { withDBAccess } from "../middlewares/with-db-access";

const app = new Hono<WorkerEnv>()
  .use(withDBAccess)
  .use(withBetterAuth)
  .all("/*", (ctx) => ctx.var.auth.handler(ctx.req.raw));

export default app;
