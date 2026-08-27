import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, "migrations");
  const migrationEntries = await readdir(migrationsPath, {
    withFileTypes: true,
  });
  const migrationDirectories = migrationEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  const migrations = await Promise.all(
    migrationDirectories.map(async (directory) => {
      const [migration] = await readD1Migrations(
        path.join(migrationsPath, directory)
      );
      if (!migration) {
        throw new Error(`Missing migration SQL in ${directory}`);
      }
      return { ...migration, name: `${directory}/migration.sql` };
    })
  );

  const recoveryKey =
    "did:key:z6MkjwbBXZnFqL8su24wGL2Fdjti6GSLv9SWdYGswfazUPm9";
  const pdsOrigin = "https://pds.test";
  process.env.CONTROL_PLANE_ACCOUNT_RECOVERY_KEY = recoveryKey;
  process.env.PDS_ORIGIN = pdsOrigin;

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: {
            CONTROL_PLANE_ACCOUNT_RECOVERY_KEY: recoveryKey,
            PDS_ORIGIN: pdsOrigin,
            TEST_MIGRATIONS: migrations,
          },
          serviceBindings: {
            PDS: () => new Response("Not implemented", { status: 501 }),
            PlcDirectory: () =>
              new Response("Not implemented", { status: 501 }),
          },
          workers: [
            {
              modules: true,
              name: "minisphere-handle-registry",
              script: `
                import { WorkerEntrypoint } from "cloudflare:workers";

                export default {
                  fetch() {
                    return new Response("Not implemented", { status: 501 });
                  }
                };

                export class HandleRegistryEntrypoint extends WorkerEntrypoint {
                  async exists() {
                    return false;
                  }

                  async register(input) {
                    return { data: input.handle, ok: true };
                  }
                }
              `,
            },
          ],
        },
        wrangler: { configPath: "./wrangler.jsonc" },
      }),
    ],
    resolve: {
      tsconfigPaths: true,
    },
    test: {
      deps: {
        optimizer: {
          ssr: {
            enabled: true,
            include: ["@atcute/crypto"],
          },
        },
      },
      setupFiles: ["./tests/apply-migrations.ts"],
    },
  };
});
