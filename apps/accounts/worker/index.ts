import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import api from "./routes";

declare global {
  interface WorkerEnv {
    Bindings: Env;
  }
}

const app = new Hono<WorkerEnv>()
  .use(logger())
  .route("/api", api)
  .notFound((c) =>
    c.json({ error: "NotFound", message: "API endpoint not found" }, 404)
  )
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  .onError((error, c) => {
    console.error(error);
    if (error instanceof HTTPException) {
      return error.getResponse();
    }

    return c.json(
      { error: "InternalServerError", message: "Internal server error" },
      500
    );
  });

export default app;
export type { ApiType } from "./routes";
