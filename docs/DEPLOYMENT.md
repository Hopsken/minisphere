# Deployment

Run commands from the repository root with Node.js 24, pnpm 11, a Cloudflare account, and a verified Resend sender. The examples below use Accounts at `https://example.com` and the PDS at `https://pds.example.com`; substitute your own domains.

Accounts and PDS default an omitted `PLC_DIRECTORY` to `https://plc.directory`; Town still requires an explicit value. Prefer setting the selected origin explicitly in all deployed clients, especially for private networks. Invalid explicit values fail configuration validation, and request failures never switch directories. Public PLC writes are persistent public records; omission can therefore publish PDS-created identities publicly. Do not switch an existing network between directories without migrating identities.

## 1. Audit existing deployments

Before deploying, back up D1 and encryption keys and record the effective Accounts, PDS, handle, and PLC origins. Preserve those origins and all five existing secrets: Accounts `BETTER_AUTH_SECRET`, `ACCOUNTS_ENCRYPTION_KEY`, and `RESEND_API_KEY`; PDS `PDS_JWT_SECRET` and `PDS_ENCRYPTION_KEY`. No session JWT design changes are part of this migration.

Reserved usernames are now enforced by the authoritative categorized list in [`apps/accounts/worker/lib/reserved-usernames.ts`](../apps/accounts/worker/lib/reserved-usernames.ts), including `pds`. Audit every occupied normalized username against that file before rollout. A practical audit is to export occupied usernames from Accounts D1, extract the quoted entries from the category lists, normalize both sets to lowercase, and compare their exact intersection. Review every match, especially `pds`, and plan an explicit migration with the account owner. Never silently rename or delete an account.

The former Handle Registry Worker and `AccountsEntrypoint` are removed. The old Registry cannot call the new Accounts version. Schedule a maintenance window for the Accounts deployment and wildcard-route cutover; this is not a zero-downtime migration. Delete the old Worker only after verifying the new route.

## 2. Create resources

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm --filter @minisphere/directory exec wrangler d1 create minisphere-directory # Private PLC only
pnpm --filter @minisphere/pds exec wrangler d1 create minisphere-pds
pnpm --filter @minisphere/accounts exec wrangler d1 create minisphere-accounts
```

Put returned IDs in the owning `wrangler.jsonc`; retain existing IDs for existing deployments. Create `minisphere-pds` and `minisphere-accounts` Workers, plus `minisphere-directory` for private PLC and optionally `minisphere-town`. Worker names and the Accounts-to-PDS service binding remain in Wrangler configuration.

## 3. Set Dashboard runtime values

Use **Settings → Variables and Secrets**, not Builds settings. Production runtime configuration remains Dashboard-managed and `keep_vars` preserves it.

| Worker | Text variable | Production value |
| --- | --- | --- |
| Accounts | `MINISPHERE_ORIGIN` | `https://example.com` |
| Accounts | `PLC_DIRECTORY` | optional; defaults to `https://plc.directory` |
| Accounts | `EMAIL_FROM` | verified Resend sender |
| Accounts | `EMAIL_ALLOWLIST` | permitted addresses/domains or `*` |
| PDS | `MINISPHERE_ORIGIN` | `https://example.com` |
| PDS | `PLC_DIRECTORY` | optional; same selected PLC origin |

`MINISPHERE_ORIGIN` is required in both Workers. It derives the Accounts origin, `example.com` handle suffix, and `https://pds.example.com`. Production uses this layout without `PDS_ORIGIN` or `PUBLIC_HANDLE_DOMAIN` overrides; those are only needed for a different layout, such as local development. Accounts `PUBLIC_URL` and PDS `ACCOUNTS_ORIGIN` are not runtime configuration inputs. Both Workers read `cloudflare:workers` environment bindings in `resolveConfig()` when configuration is needed.

Keep the five secrets listed above unchanged. Generate secrets only for a new deployment (`openssl rand -base64 32`, except the Resend-issued key) and back up encryption keys. Do not upload `.dev.vars.example`, and do not configure Town's development resolver in production.

## 4. Deploy in dependency order

Review the [Accounts database migration warning](../apps/accounts/README.md#database) and stop on failure. Worker-first asset paths include `/.well-known/atproto-did`, `/.well-known/oauth-authorization-server`, `/xrpc/com.atproto.identity.resolveHandle`, `/api/*`, `/oauth/*`, and `/__dev/*`, so these requests reach the Worker rather than the SPA fallback.

```sh
pnpm build
pnpm --filter @minisphere/directory run db:migrate:remote # Private PLC only
pnpm --filter @minisphere/directory run deploy            # Private PLC only
pnpm --filter @minisphere/pds run db:migrate:remote
pnpm --filter @minisphere/pds run deploy
pnpm --filter @minisphere/accounts run db:migrate:remote
pnpm --filter @minisphere/accounts run deploy
pnpm --filter @minisphere/town run deploy                 # Optional
```

Use `run deploy`, not pnpm's built-in deploy command. A code rollback does not reverse database migrations.

## 5. Configure domains and route

In **Settings → Domains & Routes**:

1. Add the Accounts Custom Domain `example.com`.
2. Add the PDS Custom Domain `pds.example.com`.
3. Create proxied wildcard DNS and ensure a certificate covers `*.example.com`.
4. After Accounts verification, route exactly `*.example.com/.well-known/atproto-did` to Accounts.

Do **not** add a blanket `*.example.com/*` route: it would capture unrelated subdomain traffic. Wrangler does not create or modify these Dashboard-managed resources automatically.

## 6. Workers Builds

Use build variables `NODE_VERSION=24`, `PNPM_VERSION=11.21.0`, and `SKIP_DEPENDENCY_INSTALL=1`. Build with:

```sh
pnpm -w install --frozen-lockfile && pnpm -w exec turbo run build --filter=PACKAGE
```

| Worker | Root | Package | Deploy command |
| --- | --- | --- | --- |
| Directory (private only) | `apps/directory` | `@minisphere/directory` | `pnpm run db:migrate:remote && pnpm run deploy` |
| PDS | `apps/pds` | `@minisphere/pds` | `pnpm run db:migrate:remote && pnpm run deploy` |
| Accounts | `apps/accounts` | `@minisphere/accounts` | `pnpm run db:migrate:remote && pnpm run deploy` |
| Town (optional) | `examples/town` | `@minisphere/town` | `pnpm run deploy` |

Build variables are not runtime bindings. Disable previews unless they have separate resources. The token needs Worker deployment and D1 edit permissions.

CI applies migrations without confirmation. For manual approval, migrate separately and use `pnpm run deploy` only. Workers Builds does not wait for GitHub checks or other Workers; coordinate releases that change service contracts.

For optional Town, set runtime `PUBLIC_URL` and the same `PLC_DIRECTORY`, then add its matching Custom Domain. A private Directory also needs a Custom Domain matching `PLC_DIRECTORY`; public PLC deployments need no Directory Worker.

## 7. Verify and cut over

Before changing the wildcard route, verify Accounts directly:

- Accounts and PDS `/health` succeed with the intended runtime variables; these probes validate configuration only and do not establish dependency availability. Invalid configuration produces a generic error;
- `/.well-known/oauth-authorization-server` advertises `https://example.com`;
- PDS `/.well-known/oauth-protected-resource` advertises the derived production origins;
- `/xrpc/com.atproto.identity.resolveHandle?handle=<active-user>.example.com` returns the active DID and permits XRPC CORS;
- inactive and unknown names do not resolve; reserved names cannot be newly registered (existing records require the audit above);
- login, username creation, and Town OAuth still work; and
- `/__dev/log-me-in/dev@example.com` returns 404.

Then switch only the well-known wildcard route, verify `https://<active-user>.example.com/.well-known/atproto-did`, and only afterward remove the old Handle Registry Worker. These are manual Cloudflare changes; deployment performs none automatically.

See [current limitations](../DEVELOPMENT.md) before accepting real user data. Test account creation writes persistent identity data.
