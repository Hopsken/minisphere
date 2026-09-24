import { createMiddleware } from "hono/factory";

import { createIdentityResolvers } from "../clients/identity";
import { resolveConfig } from "../config";
import { RepoWriter } from "../services/repo-writer";
import type { ResourceVariables } from "./with-resource-auth";

export const withRepoWriter = createMiddleware<{
  Bindings: Env;
  Variables: ResourceVariables & { repoWriter: RepoWriter };
}>((ctx, next) => {
  const config = resolveConfig();
  const { did, scope } = ctx.var.authorization;
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
