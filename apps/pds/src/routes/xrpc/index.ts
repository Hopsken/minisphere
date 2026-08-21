import { Hono } from "hono";

import repoRoutes from "./repo";
import syncRoutes from "./sync";

const app = new Hono<{
  Bindings: Env;
}>();

app.get("/_health", (c) => c.json({ ok: true }));

app.route("/", repoRoutes);
app.route("/", syncRoutes);

export default app;
