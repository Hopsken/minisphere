import * as plc from "@did-plc/lib";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { Database } from "./db";
import { DidService } from "./did-service";
import { validateIncomingOperation } from "./validator";

const app = new Hono<{
  Bindings: Env;
  Variables: {
    db: Database;
    didService: DidService;
  };
}>();

app.use((ctx, next) => {
  ctx.set("didService", new DidService(ctx.var.db));
  return next();
});

app.get("/:did", async (ctx) => {
  const did = ctx.req.param("did");
  const didService = ctx.get("didService");

  const last = await didService.lastOpForDid(did);
  if (!last) {
    throw new HTTPException(404, {
      message: `DID not registered: ${did}`,
    });
  }

  const data = plc.opToData(did, last);
  if (!data) {
    throw new HTTPException(404, {
      message: `DID not available: ${did}`,
    });
  }

  const document = plc.formatDidDoc(data);
  return ctx.json(document, 200, {
    "Content-Type": "application/did+ld+json",
  });
});

app.get("/:did/data", async (ctx) => {
  const did = ctx.req.param("did");
  const didService = ctx.get("didService");

  const last = await didService.lastOpForDid(did);
  if (!last) {
    throw new HTTPException(404, {
      message: `DID not registered: ${did}`,
    });
  }

  const data = plc.opToData(did, last);
  if (!data) {
    throw new HTTPException(404, {
      message: `DID not available: ${did}`,
    });
  }

  return ctx.json(data);
});

app.get("/:did/log", async (ctx) => {
  const did = ctx.req.param("did");
  const didService = ctx.get("didService");

  const ops = await didService.opsForDid(did);
  if (!ops.length) {
    throw new HTTPException(404, { message: `DID not registered: ${did}` });
  }

  return ctx.json(ops);
});

app.get("/:did/log/audit", async (ctx) => {
  const did = ctx.req.param("did");
  const didService = ctx.get("didService");

  const ops = await didService.indexedOpsForDid(did, true);
  if (!ops.length) {
    throw new HTTPException(404, { message: `DID not registered: ${did}` });
  }

  const log = ops.map((op) => ({
    ...op,
    cid: op.cid.toString(),
    createdAt: op.createdAt.toISOString(),
  }));

  return ctx.json(log);
});

app.get("/:did/log/last", async (ctx) => {
  const did = ctx.req.param("did");
  const didService = ctx.get("didService");

  const last = await didService.lastOpForDid(did);
  if (!last) {
    throw new HTTPException(404, { message: `DID not registered: ${did}` });
  }

  return ctx.json(last);
});

app.post("/:did", async (ctx) => {
  const did = ctx.req.param("did");
  const didService = ctx.get("didService");

  const input = await ctx.req.json<unknown>();
  const proposed = validateIncomingOperation(input);
  await didService.validateAndAddOp(did, proposed, new Date());
  return ctx.json({ ok: true });
});

export default app;
