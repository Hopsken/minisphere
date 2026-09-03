import { Hono } from "hono";

const app = new Hono<WorkerEnv>().get("/", (ctx) =>
  ctx.json({ oidcProviderName: ctx.env.OIDC_PROVIDER_NAME })
);

export default app;
