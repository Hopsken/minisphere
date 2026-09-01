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

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: {
            BETTER_AUTH_SECRET:
              "local-test-better-auth-secret-at-least-32-characters",
            PDS_ORIGIN: "https://pds.test",
            PUBLIC_URL: "https://accounts.test",
            TEST_MIGRATIONS: migrations,
          },
          workers: [
            {
              modules: true,
              name: "minisphere-pds",
              script: `
                import { WorkerEntrypoint } from "cloudflare:workers";

                export default {
                  fetch() {
                    return new Response("Not implemented", { status: 501 });
                  }
                };

                export class PdsControlPlane extends WorkerEntrypoint {
                  generateInviteCode() {
                    return crypto.randomUUID();
                  }

                  issueOAuthAccessToken(input) {
                    const claims = btoa(JSON.stringify(input));
                    return \`test.\${claims}.\${crypto.randomUUID()}\`;
                  }
                }
              `,
            },
          ],
        },
        wrangler: { configPath: "./wrangler.jsonc" },
      }),
    ],
    test: {
      setupFiles: ["./tests/apply-migrations.ts"],
    },
  };
});
