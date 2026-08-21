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

  const inviteKey = await Secp256k1PrivateKeyExportable.importRaw(
    new Uint8Array(32).fill(1)
  );
  const invitePrivateMultikey = await inviteKey.exportPrivateKey("multikey");
  const encryptionKey = Buffer.alloc(32, 7).toString("base64url");
  const pdsOrigin = "https://pds.test";
  process.env.CONTROL_PLANE_ENCRYPTION_KEY = encryptionKey;
  process.env.CONTROL_PLANE_INVITE_KEY = invitePrivateMultikey;
  process.env.PDS_ORIGIN = pdsOrigin;

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: {
            CONTROL_PLANE_ENCRYPTION_KEY: encryptionKey,
            CONTROL_PLANE_INVITE_KEY: invitePrivateMultikey,
            PDS_ORIGIN: pdsOrigin,
            TEST_MIGRATIONS: migrations,
          },
        },
        wrangler: { configPath: "./wrangler.jsonc" },
      }),
    ],
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
