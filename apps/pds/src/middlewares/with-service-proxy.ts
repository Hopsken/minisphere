import { createMiddleware } from "hono/factory";

import { createIdentityResolvers } from "../clients/identity";
import { resolveConfig } from "../config";
import { ServiceProxy } from "../services/service-proxy";
import type { ResourceVariables } from "./with-resource-auth";

export const withServiceProxy = createMiddleware<{
  Bindings: Env;
  Variables: ResourceVariables & { serviceProxy: ServiceProxy };
}>((ctx, next) => {
  const { did, scope } = ctx.var.authorization;
  ctx.set(
    "serviceProxy",
    new ServiceProxy(
      did,
      scope,
      createIdentityResolvers(resolveConfig().plcDirectory).documents,
      ctx.env.REPO
    )
  );
  return next();
});
