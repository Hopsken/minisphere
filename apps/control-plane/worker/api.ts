import { Hono } from "hono";

import accountsRoutes from "./routes/accounts";

const api = new Hono<WorkerEnv>().route("/accounts", accountsRoutes);

export type ApiType = typeof api;
export default api;
