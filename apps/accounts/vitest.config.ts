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
  const [entrywayRotationKey, oauthSigningKey, repoSigningKey] =
    await Promise.all([
      Secp256k1PrivateKeyExportable.createKeypair(),
      Secp256k1PrivateKeyExportable.createKeypair(),
      Secp256k1PrivateKeyExportable.createKeypair(),
    ]);
  const [
    entrywayRotationKeyMultikey,
    oauthSigningKeyMultikey,
    repoSigningKeyDid,
  ] = await Promise.all([
    entrywayRotationKey.exportPrivateKey("multikey"),
    oauthSigningKey.exportPrivateKey("multikey"),
    repoSigningKey.exportPublicKey("did"),
  ]);

  return {
    plugins: [
      cloudflareTest({
        miniflare: {
          bindings: {
            ACCOUNTS_OAUTH_SIGNING_KEY: oauthSigningKeyMultikey,
            ACCOUNTS_PLC_ROTATION_KEY: entrywayRotationKeyMultikey,
            BETTER_AUTH_SECRET:
              "local-test-better-auth-secret-at-least-32-characters",
            OIDC_PROVIDER_NAME: "Test Identity",
            PDS_ORIGIN: "https://pds.test",
            PUBLIC_HANDLE_DOMAIN: "r2d2.party",
            PUBLIC_URL: "https://accounts.test",
            TEST_MIGRATIONS: migrations,
          },
          outboundService: "minisphere-test-oidc",
          workers: [
            {
              modules: true,
              name: "minisphere-directory",
              routes: ["https://directory.test/*"],
              script: `
                const operations = new Map();

                export default {
                  async fetch(request) {
                    const url = new URL(request.url);
                    const [did, endpoint] = url.pathname.split("/").filter(Boolean);
                    if (request.method === "POST" && did && !endpoint) {
                      operations.set(decodeURIComponent(did), await request.json());
                      return Response.json({ ok: true });
                    }
                    const operation = did ? operations.get(decodeURIComponent(did)) : null;
                    if (request.method !== "GET" || endpoint !== "data" || !operation) {
                      return Response.json({ message: "DID not registered" }, { status: 404 });
                    }
                    const { sig, ...state } = operation;
                    return Response.json({ did: decodeURIComponent(did), ...state });
                  }
                };
              `,
            },
            {
              modules: true,
              name: "minisphere-pds",
              script: `
                import { WorkerEntrypoint } from "cloudflare:workers";

                const accounts = new Set();
                const inviteCodes = new Set();

                const handleRequest = async (request, env) => {
                  const url = new URL(request.url);
                  if (request.method === "POST" && url.pathname === "/xrpc/com.atproto.server.reserveSigningKey") {
                    return Response.json({ signingKey: ${JSON.stringify(repoSigningKeyDid)} });
                  }
                  if (request.method === "GET" && url.pathname === "/xrpc/com.atproto.sync.getRepoStatus") {
                    const did = url.searchParams.get("did") ?? "";
                    return Response.json({ active: accounts.has(did), did });
                  }
                  if (request.method !== "POST" || url.pathname !== "/xrpc/com.atproto.server.createAccount") {
                    return new Response("Not Found", { status: 404 });
                  }

                  const input = await request.json();
                  if (!input.inviteCode || !inviteCodes.has(input.inviteCode)) {
                    return Response.json(
                      { error: "InvalidRequest", message: "Invalid invite code" },
                      { status: 400 }
                    );
                  }
                  if (input.handle.startsWith("unavailable.")) {
                    return Response.json(
                      { error: "InvalidRequest", message: "Rejected account" },
                      { status: 400 }
                    );
                  }
                  if (input.handle.startsWith("waiting.")) {
                    throw new Error("Simulated timeout before account creation");
                  }
                  if (accounts.has(input.did)) {
                    return Response.json(
                      { error: "InvalidRequest", message: "Account already exists" },
                      { status: 400 }
                    );
                  }

                  accounts.add(input.did);
                  inviteCodes.delete(input.inviteCode);
                  if (!input.handle.startsWith("pds-only.")) {
                    await env.DIRECTORY.fetch(
                      new Request(\`https://directory.test/\${encodeURIComponent(input.did)}\`, {
                        body: JSON.stringify(input.plcOp),
                        headers: { "Content-Type": "application/json" },
                        method: "POST"
                      })
                    );
                  }
                  if (input.handle.startsWith("recovered.")) {
                    throw new Error("Simulated timeout after account creation");
                  }
                  return Response.json({
                    accessJwt: "unused-test-access-token",
                    did: input.did,
                    handle: input.handle,
                    refreshJwt: "unused-test-refresh-token"
                  });
                };

                export default {
                  fetch(request, env) {
                    return handleRequest(request, env);
                  }
                };

                export class PdsControlPlane extends WorkerEntrypoint {
                  generateInviteCode() {
                    const inviteCode = crypto.randomUUID();
                    inviteCodes.add(inviteCode);
                    return inviteCode;
                  }

                  fetch(request) {
                    return handleRequest(request, this.env);
                  }
                }
              `,
              serviceBindings: { DIRECTORY: "minisphere-directory" },
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
