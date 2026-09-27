import { zValidator } from "@minisphere/hono-utils";
import { Hono } from "hono";
import { z } from "zod";

import { createAppPasswordSchema } from "../../schema/app-password";
import { requireSameOrigin } from "../middlewares/require-same-origin";
import { withBetterAuth } from "../middlewares/with-better-auth";
import { withDBAccess } from "../middlewares/with-db-access";
import { withSession } from "../middlewares/with-session";
import { AppPasswordRepository } from "../repositories/app-password-repository";
import { AppPasswords } from "../services/app-passwords";

const app = new Hono<WorkerEnv>()
  .use(withDBAccess)
  .use(withBetterAuth)
  .use(withSession({ required: true }))
  .use((ctx, next) => {
    ctx.header("Cache-Control", "no-store");
    return next();
  })
  .get("/", async (ctx) => {
    const service = new AppPasswords(
      new AppPasswordRepository(ctx.var.database)
    );
    return ctx.json({
      appPasswords: await service.list(ctx.var.session.user.id),
    });
  })
  .post(
    "/",
    requireSameOrigin,
    zValidator("json", createAppPasswordSchema),
    async (ctx) => {
      const service = new AppPasswords(
        new AppPasswordRepository(ctx.var.database)
      );
      return ctx.json(
        await service.create(ctx.var.session.user.id, ctx.req.valid("json")),
        201
      );
    }
  )
  .delete(
    "/:id",
    requireSameOrigin,
    zValidator("param", z.object({ id: z.uuid() })),
    async (ctx) => {
      const service = new AppPasswords(
        new AppPasswordRepository(ctx.var.database)
      );
      await service.revoke(ctx.var.session.user.id, ctx.req.valid("param").id);
      return ctx.body(null, 204);
    }
  );

export default app;
