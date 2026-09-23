import { createMiddleware } from "hono/factory";

import { createIdentityResolvers } from "../clients/identity";
import { resolveConfig } from "../config";
import { createPdsDatabase } from "../db";
import { AccountRepository } from "../repositories/account";
import { RepoReader } from "../services/repo-reader";

export const withRepoReader = createMiddleware<{
  Bindings: Env;
  Variables: {
    repoReader: RepoReader;
  };
}>((ctx, next) => {
  if (!ctx.var.repoReader) {
    const identities = createIdentityResolvers(resolveConfig().plcDirectory);
    ctx.set(
      "repoReader",
      new RepoReader(
        new AccountRepository(createPdsDatabase(ctx.env.PDS_DB)),
        ctx.env.REPO,
        identities.handles,
        identities.documents
      )
    );
  }

  return next();
});
