import { Hono } from "hono";

const app = new Hono<WorkerEnv>().get("/", (ctx) =>
  ctx.json({ oidcProviderName: ctx.var.config.oidc?.providerName ?? null })
);

export default app;
