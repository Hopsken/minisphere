import { zValidator } from "@minisphere/hono-utils";
import { Hono } from "hono";
import z from "zod";

import { createPdsClient } from "../clients/pds-client";
import { withBetterAuth } from "../middlewares/with-better-auth";
import { withDBAccess } from "../middlewares/with-db-access";
import { withSession } from "../middlewares/with-session";
import { UserRepository } from "../repositories/user-repository";
import { DidAccountService } from "../services/accounts";

const app = new Hono<WorkerEnv>()
  .use(withDBAccess)
  .use(withBetterAuth)
  .post(
    "/atproto",
    withSession({ required: true }),
    zValidator(
      "json",
      z.object({
        username: z.string().min(3).max(30),
      })
    ),
    async (ctx, next) => {
      const { auth, session, database } = ctx.var;
      const { username } = ctx.req.valid("json");

      const pdsClient = createPdsClient(ctx.env);

      const userRepo = new UserRepository(database);
      const accountService = new DidAccountService(auth, pdsClient);

      const newUser = await accountService.createDidAccount(ctx.env, username);
      await userRepo.linkUser(session.user.id, newUser.id);

      return next();
    }
  );

export default app;
