import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_ACCOUNTS_OAUTH_SIGNING_KEY: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
