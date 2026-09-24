import { createMiddleware } from "hono/factory";

import { ResourceAuth } from "../auth/resource";
import { resolveConfig } from "../config";
import { createPdsDatabase } from "../db";
import { AccountRepository } from "../repositories/account";
import { DpopStateRepository } from "../repositories/dpop-state";

export interface ResourceVariables {
  authorization: Awaited<ReturnType<ResourceAuth["authenticate"]>>;
}

export const withResourceAuth = createMiddleware<{
  Bindings: Env;
  Variables: ResourceVariables;
}>(async (ctx, next) => {
  const config = resolveConfig();
  const db = createPdsDatabase(ctx.env.PDS_DB);
  const state = new DpopStateRepository(db);
  ctx.header("DPoP-Nonce", await state.createNonce());
  ctx.header("Cache-Control", "no-store");
  const auth = new ResourceAuth(
    new AccountRepository(db),
    state,
    config.accountsOrigin,
    config.pdsOrigin
  );
  ctx.set("authorization", await auth.authenticate(ctx.req.raw));
  return next();
});
