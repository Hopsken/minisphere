import { Hono } from "hono";

import authRoutes from "./auth";

const api = new Hono<WorkerEnv>().route("/auth", authRoutes);

export default api;
export type ApiType = typeof api;
