import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files run outside per-test storage isolation. Each test receives a
// clean database containing the fully migrated schema.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
