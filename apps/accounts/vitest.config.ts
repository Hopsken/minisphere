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
            OIDC_CLIENT_ID: "accounts-test-client",
            OIDC_CLIENT_SECRET: "accounts-test-client-secret",
            OIDC_DISCOVERY_URL:
              "https://oidc.test/.well-known/openid-configuration",
            OIDC_PROVIDER_NAME: "Test Identity",
            PDS_ORIGIN: "https://pds.test",
            PUBLIC_URL: "https://accounts.test",
            TEST_MIGRATIONS: migrations,
          },
          outboundService: "minisphere-test-oidc",
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
                  createAccount(input) {
                    if (input.handle.startsWith("waiting.")) {
                      throw new Error("Simulated unknown outcome");
                    }
                    if (input.handle.startsWith("unavailable.")) {
                      return { reason: "handle_unavailable", status: "failed" };
                    }
                    const label = input.handle.split(".")[0].padEnd(24, "0").slice(0, 24);
                    return {
                      did: \`did:plc:\${label}\`,
                      handle: input.handle,
                      status: "active"
                    };
                  }

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
            {
              modules: true,
              name: "minisphere-test-oidc",
              routes: ["https://oidc.test/*"],
              script: `export default {
                fetch(request) {
                  const url = new URL(request.url);
                  if (url.pathname === "/.well-known/openid-configuration") {
                    return Response.json({
                      authorization_endpoint: "https://oidc.test/authorize",
                      id_token_signing_alg_values_supported: ["RS256"],
                      issuer: "https://oidc.test",
                      jwks_uri: "https://oidc.test/jwks",
                      token_endpoint: "https://oidc.test/token",
                      userinfo_endpoint: "https://oidc.test/userinfo"
                    });
                  }
                  if (url.pathname === "/jwks") {
                    return Response.json({ keys: [] });
                  }
                  return new Response("Not Found", { status: 404 });
                }
              }`,
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
