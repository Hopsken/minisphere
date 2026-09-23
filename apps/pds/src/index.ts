import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";

import { resolveConfig } from "./config";
import { createPdsDatabase } from "./db";
import { InviteCodeRepository } from "./repositories/invite-code";
import xrpcRoutes from "./routes/xrpc";

const app = new Hono<{
  Bindings: Env;
}>();

app
  .use(cors({ exposeHeaders: ["DPoP-Nonce", "WWW-Authenticate"] }))
  .use(logger());

app.get("/", (ctx) => ctx.json({ name: "pds" }));

app.get("/health", (ctx) => {
  ctx.header("Cache-Control", "no-store");
  resolveConfig();
  return ctx.json({ status: "ok" });
});

app.get("/.well-known/oauth-protected-resource", (ctx) => {
  const config = resolveConfig();
  ctx.header("Cache-Control", "public, max-age=300");
  return ctx.json({
    authorization_servers: [config.accountsOrigin],
    resource: config.pdsOrigin,
  });
});

app.route("/xrpc", xrpcRoutes);

// oxlint-disable-next-line promise/prefer-await-to-callbacks
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    // Preserve nonce and CORS headers prepared by middleware on error responses.
    const nonce = c.res.headers.get("DPoP-Nonce");
    if (nonce) {
      const response = err.getResponse();
      response.headers.set("DPoP-Nonce", nonce);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    return err.getResponse();
  }

  console.error(err);
  // For any other unexpected errors, log and return a generic 500 response
  return c.text("Internal Server Error", 500);
});

export default {
  fetch: app.fetch,
};

export class PdsControlPlane extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }

  generateInviteCode(): Promise<string> {
    return new InviteCodeRepository(
      createPdsDatabase(this.env.PDS_DB)
    ).create();
  }
}

export { RepoDO } from "@minisphere/repo-do";
