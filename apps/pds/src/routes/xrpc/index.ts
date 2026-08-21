import { Hono } from "hono";

import identityRoutes from "./identity";
import repoRoutes from "./repo";
import serverRoutes from "./server";
import syncRoutes from "./sync";

const app = new Hono<{
  Bindings: Env;
}>();

app.get("/_health", (c) => c.json({ ok: true }));

app.route("/", identityRoutes);
app.route("/", repoRoutes);
app.route("/", serverRoutes);
app.route("/", syncRoutes);

export default app;
