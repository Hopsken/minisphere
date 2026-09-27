import { zValidator } from "@minisphere/hono-utils";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
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

const sessionMethods =
  "/xrpc/:method{com\\.atproto\\.server\\.(?:create|refresh|get|delete)Session}";

export default new Hono<WorkerEnv>()
  .use(sessionMethods, cors())
  .use(sessionMethods, withDBAccess, (ctx, next) => {
    ctx.header("Cache-Control", "no-store");
    return next();
  })
  .post(
    "/xrpc/com.atproto.server.createSession",
    zValidator("json", createSessionSchema),
    async (ctx) => {
      const { identifier, password } = ctx.req.valid("json");
      return ctx.json(
        await sessions(ctx.var.database).create(identifier, password)
      );
    }
  )
  .post("/xrpc/com.atproto.server.refreshSession", async (ctx) =>
    ctx.json(
      await sessions(ctx.var.database).refresh(
        bearerToken(ctx.req.header("Authorization"))
      )
    )
  )
  .get("/xrpc/com.atproto.server.getSession", async (ctx) =>
    ctx.json(
      await sessions(ctx.var.database).get(
        bearerToken(ctx.req.header("Authorization"))
      )
    )
  )
  .post("/xrpc/com.atproto.server.deleteSession", async (ctx) => {
    await sessions(ctx.var.database).delete(
      bearerToken(ctx.req.header("Authorization"))
    );
    return ctx.body(null, 200);
  })
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  .onError((error, ctx) => {
    if (error instanceof XrpcError) {
      return ctx.json(
        { error: error.error, message: error.message },
        error.status
      );
    }
    if (error instanceof HTTPException) {
      return ctx.json(
        { error: "InvalidRequest", message: error.message },
        error.status
      );
    }
    console.error(error);
    return ctx.json(
      { error: "InternalServerError", message: "Internal server error" },
      500
    );
  });
