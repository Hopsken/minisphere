import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        workers: [
          {
            modules: true,
            name: "minisphere-accounts",
            script: `
              import { WorkerEntrypoint } from "cloudflare:workers";

              export default {
                fetch() {
                  return new Response("Not implemented", { status: 501 });
                }
              };

              export class AccountsEntrypoint extends WorkerEntrypoint {
                resolveHandle(handle) {
                  return handle === "alice.r2d2.party"
                    ? "did:plc:alice0000000000000000000"
                    : null;
                }
              }
            `,
          },
        ],
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
