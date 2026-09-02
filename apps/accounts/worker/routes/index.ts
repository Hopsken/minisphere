import { Hono } from "hono";

import accountRoutes from "./account";
import authRoutes from "./auth";
import configurationRoutes from "./configuration";

const api = new Hono<WorkerEnv>()
  .route("/auth", authRoutes)
  .route("/account", accountRoutes)
  .route("/configuration", configurationRoutes);

export default api;
export type ApiType = typeof api;
