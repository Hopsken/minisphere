import { readdir } from "node:fs/promises";
import path from "node:path";

import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
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

  const rotationKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const rotationKeyMultikey = await rotationKey.exportPrivateKey("multikey");
  const jwtSecret = "test-pds-jwt-secret-with-at-least-32-bytes";
  process.env.PDS_JWT_SECRET = jwtSecret;
  process.env.PDS_ROTATION_KEY = rotationKeyMultikey;

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: {
            PDS_JWT_SECRET: jwtSecret,
            PDS_ROTATION_KEY: rotationKeyMultikey,
            TEST_MIGRATIONS: migrations,
          },
          workers: [
            {
              modules: true,
              name: "minisphere-directory",
              script: `export default {
                async fetch(request) {
                  if (request.method !== "POST") {
                    return new Response("Method Not Allowed", { status: 405 });
                  }
                  const did = decodeURIComponent(new URL(request.url).pathname.slice(1));
                  const operation = await request.json();
                  if (
                    !did.startsWith("did:plc:") ||
                    operation.type !== "plc_operation" ||
                    operation.prev !== null ||
                    typeof operation.sig !== "string" ||
                    operation.services?.atproto_pds?.endpoint !== "https://pds.test"
                  ) {
                    return Response.json({ message: "Invalid operation" }, { status: 400 });
                  }
                  return Response.json({ ok: true });
                }
              }`,
            },
          ],
        },
        wrangler: { configPath: "./wrangler.jsonc" },
      }),
    ],
    test: {
      deps: {
        optimizer: {
          ssr: {
            enabled: true,
            include: [
              "@atcute/crypto",
              "@minisphere/repo-do > @atproto/crypto",
            ],
          },
        },
      },
      setupFiles: ["./tests/apply-migrations.ts"],
    },
  };
});
