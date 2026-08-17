import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { createDatabase } from "./db.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (context) =>
  context.json({
    name: "minisphere-directory",
  })
);

app.get("/health", async (context) => {
  const database = createDatabase(context.env.DB);
  await database.run(sql`SELECT 1`);

  return context.json({ status: "ok" });
});

export default app;
