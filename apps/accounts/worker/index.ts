import { Hono } from "hono";

import { createAuth } from "./auth";
import { createDatabase } from "./db";

const app = new Hono<{ Bindings: Env }>();

app.all("/api/auth/*", (context) => {
  const auth = createAuth(
    createDatabase(context.env.DB),
    context.env.BETTER_AUTH_SECRET,
    new URL(context.req.url).origin
  );

  return auth.handler(context.req.raw);
});

export default app;
