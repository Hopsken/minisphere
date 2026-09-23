# Deployment

Run commands from the repository root. Use Node.js 24, pnpm 11, a Cloudflare account, and a verified Resend sender. Replace example domains with your own.

**Directory is optional.** Choose one mode before creating accounts:

- **Public PLC:** set `PLC_DIRECTORY=https://plc.directory` in Accounts, PDS, and Town; skip all Directory resources, deployment, domain, and Builds steps below.
- **Private PLC:** deploy Directory and set the same variable to its HTTP origin in all three apps. Local templates use `http://localhost:8788`.

Use the same mode for Accounts, PDS, and Town. Public PLC writes are public, persistent identity records. Do not use it for disposable local tests or switch an existing private network without an identity migration plan.

For existing DIDs with only a genesis operation, use the [local migration script](../apps/directory/README.md#copy-a-genesis-operation) before switching directories.

## 1. Create resources

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec wrangler login
pnpm exec wrangler whoami

pnpm --filter @minisphere/directory exec wrangler d1 create minisphere-directory # Private PLC only
pnpm --filter @minisphere/pds exec wrangler d1 create minisphere-pds
pnpm --filter @minisphere/accounts exec wrangler d1 create minisphere-accounts
```

Put each returned database ID in its project's `wrangler.jsonc`. For an existing deployment, retain its databases and IDs.

In Cloudflare, create Workers named `minisphere-pds`, `minisphere-accounts`, and `minisphere-handle-registry`. Add `minisphere-directory` for private PLC and `minisphere-town` for the optional client. Temporary Hello World Workers are sufficient. Disable their public endpoints until configuration is complete. If you rename Workers, update Wrangler names and service-binding targets too.

## 2. Set runtime values

Use each Worker's **Settings → Variables and Secrets**, not Builds settings.

| Worker | Variable | Example |
| --- | --- | --- |
| Accounts | `PUBLIC_URL` | `https://accounts.example.com` |
| Accounts | `PUBLIC_HANDLE_DOMAIN` | `example.net` |
| Accounts | `PDS_ORIGIN` | `https://pds.example.com` |
| Accounts | `EMAIL_ALLOWLIST` | `you@example.com` |
| Accounts | `EMAIL_FROM` | `Minisphere <login@example.com>` — verified in Resend |
| PDS | `ACCOUNTS_ORIGIN` | Same as Accounts `PUBLIC_URL` |
| PDS | `PDS_ORIGIN` | Same as Accounts `PDS_ORIGIN` |
| Town | `PUBLIC_URL` | `https://town.example.com` |
| Accounts, PDS, Town | `PLC_DIRECTORY` | `https://plc.directory` or your private PLC URL |

Add these as **Secrets**:

- **Accounts:** `BETTER_AUTH_SECRET`, `ACCOUNTS_ENCRYPTION_KEY`, `RESEND_API_KEY`.
- **PDS:** `PDS_JWT_SECRET`, `PDS_ENCRYPTION_KEY`.

Generate each secret separately with `openssl rand -base64 32`, except the Resend-issued API key. Back up encryption keys; replacing them makes existing encrypted data unreadable.

Directory and Handle Registry need no runtime variables. Do not upload `.dev.vars.example` values or set `DEV_HANDLE_RESOLVER_ORIGIN` in production. `keep_vars` preserves Dashboard values, but deployment does not validate missing secrets.

## 3. Deploy in order

These commands change production data. For existing databases, review the [Accounts migration warning](../apps/accounts/README.md#database) and back up data first. Stop if a command fails.

```sh
pnpm build
pnpm --filter @minisphere/directory run db:migrate:remote # Private PLC only
pnpm --filter @minisphere/directory run deploy # Private PLC only
pnpm --filter @minisphere/pds run db:migrate:remote
pnpm --filter @minisphere/pds run deploy
pnpm --filter @minisphere/accounts run db:migrate:remote
pnpm --filter @minisphere/accounts run deploy
pnpm --filter @minisphere/handle-registry run deploy
pnpm --filter @minisphere/town run deploy # Optional
```

Keep this order for the first deployment so dependencies exist. Use `run deploy`, not pnpm's built-in `deploy` command. A code rollback does not reverse database migrations.

## 4. Add domains

In **Settings → Domains & Routes**, add Custom Domains for Accounts, PDS, Directory, and Town to match the URLs above. Wrangler leaves Dashboard routes unchanged; `workers.dev` is disabled.

For Handle Registry, add the Worker route `*.example.net/*`. It requires a proxied wildcard DNS record and a certificate covering `*.example.net`. The suffix must match `PUBLIC_HANDLE_DOMAIN`.

## 5. Connect Workers Builds

Connect the repository's production branch to each Worker. Set the root directory and commands below.

Build variables: `NODE_VERSION=24`, `PNPM_VERSION=11.21.0` (match root `package.json`), and `SKIP_DEPENDENCY_INSTALL=1`.

Build command — replace `PACKAGE` with the table value:

```sh
pnpm -w install --frozen-lockfile && pnpm -w exec turbo run build --filter=PACKAGE
```

| Worker | Root directory | Package | Deploy command |
| --- | --- | --- | --- |
| Directory (private PLC only) | `apps/directory` | `@minisphere/directory` | `pnpm run db:migrate:remote && pnpm run deploy` |
| PDS | `apps/pds` | `@minisphere/pds` | `pnpm run db:migrate:remote && pnpm run deploy` |
| Accounts | `apps/accounts` | `@minisphere/accounts` | `pnpm run db:migrate:remote && pnpm run deploy` |
| Handle Registry | `apps/handle-registry` | `@minisphere/handle-registry` | `pnpm run deploy` |
| Town | `examples/town` | `@minisphere/town` | `pnpm run deploy` |

- The Builds token needs Worker deployment permissions and **D1 → Edit** for migrations.
- CI applies migrations without confirmation. For manual approval, migrate separately and use `pnpm run deploy` only.
- Builds variables do not become runtime variables. No `.dev.vars` file is needed.
- Disable preview builds until they have separate Workers, databases, secrets, and domains.
- Workers Builds does not wait for GitHub checks or other Workers. Merge tested changes; coordinate releases that change service contracts.

## 6. Verify

Check private Directory `/_health` if deployed, PDS `/.well-known/oauth-protected-resource`, Accounts `/.well-known/oauth-authorization-server`, and Town `/oauth-client-metadata.json`. All advertised origins must match production.

Use a test account to verify email login, username creation, `https://<username>.example.net/.well-known/atproto-did`, and Town OAuth login. This creates persistent account data. Accounts `/__dev/log-me-in/dev@example.com` must return 404.

See [current limitations](../DEVELOPMENT.md) before accepting real user data.
