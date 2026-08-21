import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Apply the PDS schema before the Worker tests start.
await applyD1Migrations(env.PDS_DB, env.TEST_MIGRATIONS);
