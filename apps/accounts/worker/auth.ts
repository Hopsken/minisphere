import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth/minimal";

import type { AccountsDatabase } from "./db";
import * as schema from "./db/schema";

export const createAuth = (
  database: AccountsDatabase,
  secret: string,
  baseURL: string
) =>
  betterAuth({
    appName: "Minisphere Accounts",
    baseURL,
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema,
    }),
    secret,
  });
