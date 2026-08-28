import { Hono } from "hono";

import accountRoutes from "./accounts";
import authRoutes from "./auth";

const api = new Hono<WorkerEnv>()
  .route("/auth", authRoutes)
  .route("/accounts", accountRoutes);

export default api;
export type ApiType = typeof api;
