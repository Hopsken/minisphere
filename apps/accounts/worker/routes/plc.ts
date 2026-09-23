import { zValidator } from "@minisphere/hono-utils";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { patchPlcSchema } from "../../schema/plc";
import { PlcDirectoryClient } from "../clients/plc-directory-client";
import { resolveConfig } from "../config";
import { withBetterAuth } from "../middlewares/with-better-auth";
import { withDBAccess } from "../middlewares/with-db-access";
import { withSession } from "../middlewares/with-session";
import { UserRepository } from "../repositories/user-repository";
import { PlcService } from "../services/plc";

const app = new Hono<WorkerEnv>()
  .use(withDBAccess)
  .use(withBetterAuth)
  .use(withSession({ required: true }))
  .use((ctx, next) => {
    ctx.header("Cache-Control", "no-store");
    return next();
  })
  .get("/", async (ctx) => {
    const config = resolveConfig();
    const service = new PlcService(
      new UserRepository(ctx.var.database),
      new PlcDirectoryClient(config.plcDirectory),
      ctx.env.ACCOUNTS_ENCRYPTION_KEY
    );
    return ctx.json({
      ...(await service.get(ctx.var.session.user.id)),
      expectedPdsEndpoint: config.pdsOrigin,
    });
  })
  .patch(
    "/",
    (ctx, next) => {
      if (
        ctx.req.header("Origin") !== resolveConfig().accountsOrigin ||
        (ctx.req.header("Sec-Fetch-Site") !== undefined &&
          ctx.req.header("Sec-Fetch-Site") !== "same-origin")
      ) {
        throw new HTTPException(403, {
          message: "Same-origin request required",
        });
      }
      return next();
    },
    zValidator("json", patchPlcSchema),
    async (ctx) => {
      const config = resolveConfig();
      const service = new PlcService(
        new UserRepository(ctx.var.database),
        new PlcDirectoryClient(config.plcDirectory),
        ctx.env.ACCOUNTS_ENCRYPTION_KEY
      );
      return ctx.json({
        ...(await service.patch(
          ctx.var.session.user.id,
          ctx.req.valid("json")
        )),
        expectedPdsEndpoint: config.pdsOrigin,
      });
    }
  )
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  .onError((error, ctx) => {
    // This boundary must not log provider payloads, decrypted keys, or DB errors.
    if (error instanceof HTTPException) {
      return ctx.json(
        { message: error.message, status: error.status },
        error.status
      );
    }
    return ctx.json({ message: "PLC request failed", status: 500 }, 500);
  });

export default app;
