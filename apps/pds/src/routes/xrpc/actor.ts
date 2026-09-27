import * as PutPreferences from "@atcute/bluesky/types/app/actor/putPreferences";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";

import { createPdsDatabase } from "../../db";
import { withResourceAuth } from "../../middlewares/with-resource-auth";
import { withServiceProxy } from "../../middlewares/with-service-proxy";
import { PreferencesRepository } from "../../repositories/preferences";
import { Preferences } from "../../services/preferences";
import { BSKY_APPVIEW } from "../../services/service-proxy";
import type { ServiceProxy } from "../../services/service-proxy";
import { lexiconJsonValidator } from "../../utils/lexicon-validator";
import { xrpcError } from "../../utils/xrpc-error";

const withPreferences = createMiddleware<{
  Bindings: Env;
  Variables: { preferences: Preferences };
}>((ctx, next) => {
  ctx.set(
    "preferences",
    new Preferences(
      new PreferencesRepository(createPdsDatabase(ctx.env.PDS_DB))
    )
  );
  return next();
});

/**
 * Preferences for the Bluesky AppView are stored here. A request for another
 * AppView, named by `atproto-proxy`, is proxied to it.
 */
const bskyPreferences = (lxm: string) =>
  createMiddleware<{
    Bindings: Env;
    Variables: { serviceProxy: ServiceProxy };
  }>((ctx, next) => {
    const target = ctx.req.header("atproto-proxy") ?? BSKY_APPVIEW;
    if (target !== BSKY_APPVIEW) {
      return ctx.var.serviceProxy.forward(ctx.req.raw, lxm, target);
    }
    ctx.var.serviceProxy.authorize(BSKY_APPVIEW, lxm);
    return next();
  });

export default new Hono<{ Bindings: Env }>()
  .get(
    "/app.bsky.actor.getPreferences",
    withResourceAuth,
    withServiceProxy,
    bskyPreferences("app.bsky.actor.getPreferences"),
    withPreferences,
    async (ctx) =>
      ctx.json({
        preferences: await ctx.var.preferences.get(ctx.var.authorization.did),
      })
  )
  .post(
    "/app.bsky.actor.putPreferences",
    bodyLimit({
      maxSize: 1_000_000,
      onError: () => {
        throw xrpcError("InvalidRequest", "Preferences are too large");
      },
    }),
    withResourceAuth,
    withServiceProxy,
    bskyPreferences("app.bsky.actor.putPreferences"),
    lexiconJsonValidator(PutPreferences.mainSchema.input.schema),
    withPreferences,
    async (ctx) => {
      await ctx.var.preferences.put(
        ctx.var.authorization.did,
        ctx.req.valid("json").preferences
      );
      return ctx.body(null, 200);
    }
  );
