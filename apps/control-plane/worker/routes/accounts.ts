import { zValidator } from "@minisphere/hono-utils";
import { Hono } from "hono";

import { CreateAccountInputSchema } from "../../schema";
import { createPdsClient } from "../clients/pds-client";
import { createDatabase } from "../db";
import { AccountService } from "../services/account-service";

const createAccountService = (env: Env) => {
  const pdsClient = createPdsClient(env);
  const db = createDatabase(env.DB);
  return new AccountService(db, pdsClient);
};

const app = new Hono<WorkerEnv>()
  .get("/", async (ctx) => {
    const accountService = createAccountService(ctx.env);
    const accounts = await accountService.listManagedAccounts();
    return ctx.json({ accounts });
  })
  .post("/", zValidator("json", CreateAccountInputSchema), async (ctx) => {
    const { name } = ctx.req.valid("json");
    const accountService = createAccountService(ctx.env);
    const inviteCode = await ctx.env.PDS.generateInviteCode();
    const newAccount = await accountService.createManagedAccont(ctx.env, {
      inviteCode,
      name,
    });
    return ctx.json({ account: newAccount });
  });

export default app;
