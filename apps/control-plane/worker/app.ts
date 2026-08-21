import { Hono } from "hono";

import accountsApi from "./accounts/api";
import { normalizePdsOrigin } from "./accounts/service";

interface WorkerEnv {
  Bindings: Env;
}

export const api = new Hono<WorkerEnv>()
  .get("/config", (c) => {
    const pds = normalizePdsOrigin(c.env.PDS_ORIGIN);
    return c.json({ pdsHostname: pds.hostname, pdsOrigin: pds.origin }, 200);
  })
  .route("/accounts", accountsApi);

const app = new Hono<WorkerEnv>().route("/api", api);

app.notFound((c) =>
  c.json({ error: "NotFound", message: "API endpoint not found" }, 404)
);

// oxlint-disable-next-line promise/prefer-await-to-callbacks
app.onError((error, c) => {
  console.error(error);
  return c.json(
    { error: "InternalServerError", message: "Internal server error" },
    500
  );
});

export type ApiType = typeof api;
export default app;
