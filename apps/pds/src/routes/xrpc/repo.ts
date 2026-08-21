import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/com.atproto.repo.createRecord", (c) => c.json({ ok: true }));

app.get("/com.atproto.repo.putRecord", (c) => c.json({ ok: true }));

export default app;
