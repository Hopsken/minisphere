import { Hono } from "hono";

import accountRoutes from "./account";
import appPasswordRoutes from "./app-passwords";
import authRoutes from "./auth";
import birthDateRoutes from "./birth-date";
import plcRoutes from "./plc";

const api = new Hono<WorkerEnv>()
  .route("/auth", authRoutes)
  .route("/account/plc", plcRoutes)
  .route("/account/app-passwords", appPasswordRoutes)
  .route("/account/birth-date", birthDateRoutes)
  .route("/account", accountRoutes);

export default api;
export type ApiType = typeof api;
