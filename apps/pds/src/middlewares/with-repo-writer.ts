import { createMiddleware } from "hono/factory";

import { ResourceAuth } from "../auth/resource";
import { createIdentityResolvers } from "../clients/identity";
import { resolveConfig } from "../config";
import { createPdsDatabase } from "../db";
import { AccountRepository } from "../repositories/account";
import { DpopStateRepository } from "../repositories/dpop-state";
import { RepoWriter } from "../services/repo-writer";

export const withRepoWriter = createMiddleware<{
  Bindings: Env;
  Variables: { repoWriter: RepoWriter };
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
  const { did, scope } = await auth.authenticate(ctx.req.raw);
  ctx.set(
    "repoWriter",
    new RepoWriter(
      did,
      scope,
      createIdentityResolvers(config.plcDirectory).handles,
      ctx.env.REPO
    )
  );
  return next();
});
