import { Hono } from "hono";

import actorRoutes from "./actor";
import blobRoutes from "./blobs";
import identityRoutes from "./identity";
import proxyRoutes from "./proxy";
import repoRoutes from "./repo";
import serverRoutes from "./server";
import syncRoutes from "./sync";

const app = new Hono<{
  Bindings: Env;
}>();

app.get("/_health", (c) => c.json({ ok: true }));

app.route("/", actorRoutes);
app.route("/", blobRoutes);
app.route("/", identityRoutes);
app.route("/", repoRoutes);
app.route("/", serverRoutes);
app.route("/", syncRoutes);
// Must stay last: it handles every method without a local route.
app.route("/", proxyRoutes);

export default app;
