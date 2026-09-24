import * as GetBlob from "@atcute/atproto/types/sync/getBlob";
import * as ListBlobs from "@atcute/atproto/types/sync/listBlobs";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { createPdsDatabase } from "../../db";
import { withResourceAuth } from "../../middlewares/with-resource-auth";
import { AccountRepository } from "../../repositories/account";
import { Blobs } from "../../services/blobs";
import { lexiconQueryValidator } from "../../utils/lexicon-validator";

const withBlobs = createMiddleware<{
  Bindings: Env;
  Variables: { blobs: Blobs };
}>((ctx, next) => {
  ctx.set(
    "blobs",
    new Blobs(
      ctx.env.BLOBS,
      ctx.env.REPO,
      new AccountRepository(createPdsDatabase(ctx.env.PDS_DB))
    )
  );
  ctx.header("Cache-Control", "no-store");
  return next();
});

const app = new Hono<{ Bindings: Env }>()
  .post(
    "/com.atproto.repo.uploadBlob",
    withResourceAuth,
    withBlobs,
    async (ctx) => {
      const { did, scope } = ctx.var.authorization;
      return ctx.json(await ctx.var.blobs.upload(ctx.req.raw, did, scope));
    }
  )
  .get(
    "/com.atproto.sync.getBlob",
    lexiconQueryValidator(GetBlob.mainSchema.params),
    withBlobs,
    async (ctx) => {
      const { did, cid } = ctx.req.valid("query");
      const blob = await ctx.var.blobs.get(did, cid);
      return new Response(blob.body, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Length": String(blob.size),
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Content-Type": blob.mimeType,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  )
  .get(
    "/com.atproto.sync.listBlobs",
    lexiconQueryValidator(ListBlobs.mainSchema.params),
    withBlobs,
    async (ctx) => {
      const { did, ...options } = ctx.req.valid("query");
      return ctx.json(await ctx.var.blobs.list(did, options));
    }
  );

export default app;
