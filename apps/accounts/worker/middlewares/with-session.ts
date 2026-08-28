import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import type { Auth, Session } from "../lib/better-auth";

export interface WithSessionConfig<T extends boolean> {
  required: T;
}

export const withSession = <T extends boolean>(config: WithSessionConfig<T>) =>
  createMiddleware<{
    Bindings: Env;
    Variables: {
      auth: Auth;
      session: T extends true ? Session : Session | null;
    };
  }>(async (ctx, next) => {
    const { auth } = ctx.var;
    if (!auth) {
      throw new HTTPException(500);
    }

    const session = await auth.api.getSession({
      headers: ctx.req.raw.headers,
    });

    if (config.required && !session) {
      throw new HTTPException(401);
    }

    // @ts-expect-error need to figure out how generic type works here
    ctx.set("session", session);

    return next();
  });
