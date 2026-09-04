import { Hono } from "hono";

import { getConfig } from "../config";

const app = new Hono<WorkerEnv>().get("/", (ctx) =>
  ctx.json({ oidcProviderName: getConfig().oidc?.providerName ?? null })
);

export default app;
