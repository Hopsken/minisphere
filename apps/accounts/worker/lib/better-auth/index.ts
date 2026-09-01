import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth/minimal";

import type { Database } from "../../db";
import * as schema from "../../db/schema/better-auth";
import { createAtprotoOAuthProvider } from "../atproto-oauth";
import { betterAuthOptions } from "./options";

export const createAuth = (env: Env, database: Database) =>
  betterAuth({
    ...betterAuthOptions,
    baseURL: env.PUBLIC_URL,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    plugins: [
      ...betterAuthOptions.plugins,
      createAtprotoOAuthProvider(env, database),
    ],
    secret: env.BETTER_AUTH_SECRET,
  });

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
