import { zValidator } from "@minisphere/hono-utils";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import { PlcDirectoryClient } from "../clients/plc-directory-client";
import { resolveConfig } from "../config";
import type { Database } from "../db";
import { XrpcError } from "../lib/xrpc-error";
import { withDBAccess } from "../middlewares/with-db-access";
import { AppPasswordRepository } from "../repositories/app-password-repository";
import { UserRepository } from "../repositories/user-repository";
import { AppPasswordSessions } from "../services/app-password-sessions";

const createSessionSchema = z.looseObject({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const bearerToken = (authorization: string | undefined) => {
  const token = /^Bearer (?<token>[^\s,]+)$/iu.exec(authorization ?? "")?.groups
    ?.token;
  if (!token) {
    throw new XrpcError(
      401,
      "AuthenticationRequired",
      "A Bearer token is required"
    );
  }
  return token;
};

const sessions = (database: Database) =>
  new AppPasswordSessions(
    new UserRepository(database),
    new AppPasswordRepository(database),
    new PlcDirectoryClient(resolveConfig().plcDirectory)
  );

/** Legacy `com.atproto.server` session methods for app passwords (ADR 0013). */
export default new Hono<WorkerEnv>()
  .use(cors())
  .use(withDBAccess)
  .use((ctx, next) => {
    ctx.header("Cache-Control", "no-store");
    return next();
  })
  .post(
    "/com.atproto.server.createSession",
    zValidator("json", createSessionSchema),
    async (ctx) => {
      const { identifier, password } = ctx.req.valid("json");
      return ctx.json(
        await sessions(ctx.var.database).create(identifier, password)
      );
    }
  )
  .post("/com.atproto.server.refreshSession", async (ctx) =>
    ctx.json(
      await sessions(ctx.var.database).refresh(
        bearerToken(ctx.req.header("Authorization"))
      )
    )
  )
  .get("/com.atproto.server.getSession", async (ctx) =>
    ctx.json(
      await sessions(ctx.var.database).get(
        bearerToken(ctx.req.header("Authorization"))
      )
    )
  )
  .post("/com.atproto.server.deleteSession", async (ctx) => {
    await sessions(ctx.var.database).delete(
      bearerToken(ctx.req.header("Authorization"))
    );
    return ctx.body(null, 200);
  });
