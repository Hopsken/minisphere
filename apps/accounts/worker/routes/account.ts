import { zValidator } from "@minisphere/hono-utils";
import { Hono } from "hono";
import { z } from "zod";

import { createAccountSchema, usernameSchema } from "../../schema/account";
import { createHostedHandle } from "../lib/hosted-handle";
import { withBetterAuth } from "../middlewares/with-better-auth";
import { withDBAccess } from "../middlewares/with-db-access";
import { withSession } from "../middlewares/with-session";
import { UserRepository } from "../repositories/user-repository";
import { AccountService } from "../services/account";

const app = new Hono<WorkerEnv>()
  .use(withDBAccess)
  .use(withBetterAuth)
  .use(withSession({ required: true }))
  .get("/", async (ctx) => {
    const users = new UserRepository(ctx.var.database);
    const service = new AccountService(users, ctx.env);
    return ctx.json(await service.getAccount(ctx.var.session.user.id));
  })
  .get(
    "/usernames/:username",
    zValidator("param", z.object({ username: usernameSchema })),
    async (ctx) => {
      const { username } = ctx.req.valid("param");
      const users = new UserRepository(ctx.var.database);
      return ctx.json({
        available: await users.isUsernameAvailable(username),
        handle: createHostedHandle(username, ctx.env.PUBLIC_HANDLE_DOMAIN),
        username,
      });
    }
  )
  .post("/", zValidator("json", createAccountSchema), async (ctx) => {
    const users = new UserRepository(ctx.var.database);
    const service = new AccountService(users, ctx.env);
    const result = await service.createAccount(
      ctx.var.session.user.id,
      ctx.req.valid("json").username
    );
    return result.state === "active"
      ? ctx.json(result, 201)
      : ctx.json(result, 202);
  });

export default app;
