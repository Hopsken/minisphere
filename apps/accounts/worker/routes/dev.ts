import { zValidator } from "@minisphere/hono-utils";
import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import { z } from "zod";

import { withBetterAuth } from "../middlewares/with-better-auth";
import { withDBAccess } from "../middlewares/with-db-access";

const getSafeReturnTo = (requestURL: string, returnTo: string | undefined) => {
  if (!returnTo?.startsWith("/") || returnTo.startsWith("//")) {
    return "/";
  }

  try {
    const request = new URL(requestURL);
    const destination = new URL(returnTo, request);

    if (destination.origin !== request.origin) {
      return "/";
    }

    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
};

const app = new Hono<WorkerEnv>()
  .use(withDBAccess)
  .use(withBetterAuth)
  .get(
    "/log-me-in/:email",
    zValidator("param", z.object({ email: z.email() })),
    async (ctx) => {
      const authContext = await ctx.var.auth.$context;
      const { email } = ctx.req.valid("param");
      const existingUser =
        await authContext.internalAdapter.findUserByEmail(email);
      const user =
        existingUser?.user ??
        (await authContext.internalAdapter.createUser(
          {
            email,
            emailVerified: false,
            name: email,
          },
          { method: "dev" }
        ));
      const session = await authContext.internalAdapter.createSession(user.id);
      const sessionCookie = authContext.authCookies.sessionToken;

      await setSignedCookie(
        ctx,
        sessionCookie.name,
        session.token,
        authContext.secret,
        {
          ...sessionCookie.attributes,
          maxAge: authContext.sessionConfig.expiresIn,
        }
      );

      return ctx.redirect(
        getSafeReturnTo(ctx.req.url, ctx.req.query("returnTo"))
      );
    }
  );

export default app;
