import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth/minimal";

import type { Database } from "./worker/db";
import * as schema from "./worker/db/schema/better-auth";
import { betterAuthOptions } from "./worker/lib/better-auth/options";

const { BETTER_AUTH_URL, BETTER_AUTH_SECRET } = process.env;

export default betterAuth({
  ...betterAuthOptions,
  baseURL: BETTER_AUTH_URL,
  // This file is only for drizzle cli to pick up configs, not for runtime, the database instance doesn't really needed here
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions anti-slop/require-safety-comment-for-type-assertion
  database: drizzleAdapter({} as unknown as Database, {
    provider: "sqlite",
    schema,
  }),
  secret: BETTER_AUTH_SECRET,
});
