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

  const oauthSigningKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const oauthSigningKeyMultikey =
    await oauthSigningKey.exportPrivateKey("multikey");
  const jwtSecret = "test-pds-jwt-secret-with-at-least-32-bytes";
  const signingKeyEncryptionKey =
    "test-signing-key-encryption-secret-at-least-32-bytes";
  const pdsOrigin = "https://pds.test";
  process.env.PDS_JWT_SECRET = jwtSecret;
  process.env.PDS_SIGNING_KEY_ENCRYPTION_KEY = signingKeyEncryptionKey;

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: {
            ACCOUNTS_ORIGIN: "https://accounts.test",
            PDS_JWT_SECRET: jwtSecret,
            PDS_ORIGIN: pdsOrigin,
            PDS_SIGNING_KEY_ENCRYPTION_KEY: signingKeyEncryptionKey,
            TEST_ACCOUNTS_OAUTH_SIGNING_KEY: oauthSigningKeyMultikey,
            TEST_MIGRATIONS: migrations,
          },
          workers: [
            {
              modules: true,
              name: "minisphere-directory",
              script: `const operations = new Map();

              export default {
                async fetch(request) {
                  const url = new URL(request.url);
                  const parts = url.pathname.split("/").filter(Boolean);
                  const did = decodeURIComponent(parts[0] ?? "");
                  if (request.method === "GET" && parts[1] === "log") {
                    const operation = operations.get(did);
                    return operation
                      ? Response.json([operation])
                      : Response.json({ message: "DID not found" }, { status: 404 });
                  }
                  if (request.method === "GET" && parts[1] === "data") {
                    const operation = operations.get(did);
                    if (!operation) {
                      return Response.json({ message: "DID not found" }, { status: 404 });
                    }
                    const { sig, prev, type, ...state } = operation;
                    return Response.json({ did, ...state });
                  }
                  if (request.method !== "POST" || parts.length !== 1) {
                    return new Response("Method Not Allowed", { status: 405 });
                  }
                  const operation = await request.json();
                  if (operation.alsoKnownAs?.[0] === "at://directory-failure.pds.test") {
                    return Response.json({ message: "Test failure" }, { status: 500 });
                  }
                  if (
                    !did.startsWith("did:plc:") ||
                    operation.type !== "plc_operation" ||
                    operation.prev !== null ||
                    typeof operation.sig !== "string" ||
                    operation.services?.atproto_pds?.endpoint !== "https://pds.test"
                  ) {
                    return Response.json({ message: "Invalid operation" }, { status: 400 });
                  }
                  if (operations.has(did)) {
                    return Response.json({ message: "DID already exists" }, { status: 409 });
                  }
                  operations.set(did, operation);
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
