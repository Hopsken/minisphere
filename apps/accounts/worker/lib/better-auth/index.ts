import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth/minimal";

import type { Config } from "../../config";
import type { Database } from "../../db";
import * as schema from "../../db/schema/better-auth";
import { createAtprotoOAuthProvider } from "../atproto-oauth";
import { createOidcProvider } from "./oidc";
import { betterAuthOptions } from "./options";

export const createAuth = (config: Config, database: Database) =>
  betterAuth({
    ...betterAuthOptions,
    baseURL: config.publicUrl,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    plugins: [
      ...(config.oidc ? [createOidcProvider(config.oidc)] : []),
      createAtprotoOAuthProvider(config, database),
    ],
    secret: config.betterAuthSecret,
  });

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
