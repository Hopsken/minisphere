import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth/minimal";

import { resolveConfig } from "../../config";
import type { Database } from "../../db";
import * as schema from "../../db/schema/better-auth";
import { createAtprotoOAuthProvider } from "../atproto-oauth";
import { createEmailLogin, emailLoginGuard } from "./email-login";
import { betterAuthOptions } from "./options";

export const createAuth = (env: Env, database: Database) => {
  const config = resolveConfig(env);
  return betterAuth({
    ...betterAuthOptions,
    baseURL: config.accountsOrigin,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    hooks: { before: emailLoginGuard(env) },
    plugins: [createEmailLogin(env), createAtprotoOAuthProvider(env, database)],
    secret: env.BETTER_AUTH_SECRET,
  });
};

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
