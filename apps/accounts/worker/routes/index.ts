import { Hono } from "hono";

import accountRoutes from "./account";
import authRoutes from "./auth";
import plcRoutes from "./plc";

const api = new Hono<WorkerEnv>()
  .route("/auth", authRoutes)
  .route("/account/plc", plcRoutes)
  .route("/account", accountRoutes);

export default api;
export type ApiType = typeof api;
