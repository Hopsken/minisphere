import { Hono } from "hono";

import { createAuth } from "../lib/better-auth";
import { withDBAccess } from "../middlewares/with-db-access";

const app = new Hono<WorkerEnv>().use(withDBAccess).all("/*", (ctx) => {
  const { database } = ctx.var;
  const auth = createAuth(ctx.env, database);

  return auth.handler(ctx.req.raw);
});

export default app;
