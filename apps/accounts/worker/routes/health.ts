import { Hono } from "hono";

import { configResult } from "../config";

const app = new Hono<WorkerEnv>().get("/", (ctx) => {
  if (!configResult.success) {
    return ctx.body(null, 503);
  }
  return ctx.body(null, 204);
});

export default app;
