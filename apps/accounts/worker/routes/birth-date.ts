import { zValidator } from "@minisphere/hono-utils";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { putBirthDateSchema } from "../../schema/birth-date";
import type { Database } from "../db";
import { requireSameOrigin } from "../middlewares/require-same-origin";
import { withBetterAuth } from "../middlewares/with-better-auth";
import { withDBAccess } from "../middlewares/with-db-access";
import { withSession } from "../middlewares/with-session";
import { UserRepository } from "../repositories/user-repository";

// The PDS owns the birth date as an account preference; Accounts only edits it
// (ADR 0014).
const findAccountDid = async (database: Database, userId: string) => {
  const account = await new UserRepository(database).findActiveAccount({
    userId,
  });
  if (!account) {
    throw new HTTPException(409, {
      message: "Finish setting up your account first",
    });
  }
  return account.did;
};

const app = new Hono<WorkerEnv>()
  .use(withDBAccess)
  .use(withBetterAuth)
  .use(withSession({ required: true }))
  .use((ctx, next) => {
    ctx.header("Cache-Control", "no-store");
    return next();
  })
  .get("/", async (ctx) => {
    const did = await findAccountDid(ctx.var.database, ctx.var.session.user.id);
    return ctx.json({ birthDate: await env.PDS.getBirthDate(did) });
  })
  .put(
    "/",
    requireSameOrigin,
    zValidator("json", putBirthDateSchema),
    async (ctx) => {
      const { birthDate } = ctx.req.valid("json");
      const did = await findAccountDid(
        ctx.var.database,
        ctx.var.session.user.id
      );
      await env.PDS.setBirthDate(did, birthDate);
      return ctx.json({ birthDate });
    }
  );

export default app;
