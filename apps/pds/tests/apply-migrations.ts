import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Apply the account schema before the Worker tests start.
await applyD1Migrations(env.ACCOUNT_DB, env.TEST_MIGRATIONS);
