# Deployment

Requires Node.js 24, pnpm 11, Cloudflare, and a verified Resend sender. Run commands from the repository root. Replace `example.com` with your domain.

## 1. Create resources

Create Workers named `minisphere-pds` and `minisphere-accounts`. Create their D1 databases and put the returned IDs in each app's `wrangler.jsonc`:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec wrangler login
pnpm --filter @minisphere/pds exec wrangler d1 create minisphere-pds
pnpm --filter @minisphere/accounts exec wrangler d1 create minisphere-accounts
```

Existing deployments must retain database IDs and secrets. Back up D1 and encryption keys before applying migrations; see the [Accounts migration warning](../apps/accounts/README.md#database).

## 2. Set runtime variables and secrets

Use each Worker's **Settings → Variables and Secrets**, not Builds settings. Deployments preserve these values.

| Worker | Type | Name | Value |
| --- | --- | --- | --- |
| Both | Text | `MINISPHERE_ORIGIN` | `https://example.com` |
| Accounts | Text | `EMAIL_FROM` | `Minisphere <login@notify.example.com>`; verified in Resend |
| Accounts | Text | `EMAIL_ALLOWLIST` | Comma-separated domains/emails, or `*`; empty denies login |
| Accounts | Secret | `BETTER_AUTH_SECRET` | Independent random key |
| Accounts | Secret | `ACCOUNTS_ENCRYPTION_KEY` | Independent random key |
| Accounts | Secret | `RESEND_API_KEY` | Resend API key |
| PDS | Secret | `PDS_JWT_SECRET` | Independent random key |
| PDS | Secret | `PDS_ENCRYPTION_KEY` | Independent random key |

For new deployments, generate each random key separately with `openssl rand -base64 32`. Never replace existing encryption keys or use development example secrets.

Optional overrides:

- `PLC_DIRECTORY` — defaults to `https://plc.directory` in both Workers. For a private directory, set the same origin in both. Public PLC writes are persistent; do not switch an existing network's directory without migrating identities.
- `PDS_ORIGIN` — defaults to `https://pds.example.com` in both Workers.
- `PUBLIC_HANDLE_DOMAIN` — Accounts only; defaults to `example.com`.

Omit unused overrides; do not set empty values. Origins must have no path or trailing slash. Accounts `PUBLIC_URL` and PDS `ACCOUNTS_ORIGIN` are no longer used.

## 3. Configure domains

In **Settings → Domains & Routes**:

| Worker   | Type          | Value                                   |
| -------- | ------------- | --------------------------------------- |
| Accounts | Custom Domain | `example.com`                           |
| PDS      | Custom Domain | `pds.example.com`                       |
| Accounts | Worker Route  | `*.example.com/.well-known/atproto-did` |

The wildcard needs proxied DNS and TLS coverage. Do not use `*.example.com/*`: it would capture PDS traffic. For an existing registry, defer the route switch until verification below.

## 4. Build and deploy

In **Workers Builds**, set `NODE_VERSION=24`, `PNPM_VERSION=11.21.0`, and `SKIP_DEPENDENCY_INSTALL=1`. Use this build command, replacing `PACKAGE` from the table:

```sh
pnpm -w install --frozen-lockfile && pnpm -w exec turbo run build --filter=PACKAGE
```

| Worker | Root | Package | Deploy command |
| --- | --- | --- | --- |
| PDS | `apps/pds` | `@minisphere/pds` | `pnpm run db:migrate:remote && pnpm run deploy` |
| Accounts | `apps/accounts` | `@minisphere/accounts` | `pnpm run db:migrate:remote && pnpm run deploy` |

Deploy PDS before Accounts. The token needs Worker deployment and D1 edit permissions. Builds do not wait for GitHub checks or other Workers. Disable previews unless they have separate resources.

These deploy commands apply migrations automatically. For manual approval, migrate separately and use `pnpm run deploy` only. A code rollback does not undo migrations. For CLI deployment, run the same scripts with `pnpm --filter PACKAGE run SCRIPT` after building.

Optional services:

- **Private PLC:** create `minisphere-directory` and its D1 database, set its Custom Domain, and deploy before PDS. Use root `apps/directory`, package `@minisphere/directory`, and the same migration/deploy command.
- **Town:** use root `examples/town`, package `@minisphere/town`, and `pnpm run deploy`. Set `PUBLIC_URL`, an explicit `PLC_DIRECTORY` matching Accounts/PDS, and its Custom Domain. Do not set `DEV_HANDLE_RESOLVER_ORIGIN` in production.

## 5. Verify

- Both `/health` endpoints return `200`: this checks origin configuration, not secrets or dependency availability.
- Accounts `/.well-known/oauth-authorization-server` and PDS `/.well-known/oauth-protected-resource` advertise the configured origins.
- Accounts `/xrpc/com.atproto.identity.resolveHandle?handle=<user>.example.com` and `https://<user>.example.com/.well-known/atproto-did` return the active DID; unknown and incomplete accounts do not resolve.
- Login, account creation, and optional Town OAuth work. `/__dev/log-me-in/dev@example.com` returns `404`.

**Replacing Handle Registry:** audit existing usernames against the [reserved list](../apps/accounts/worker/lib/reserved-usernames.ts), especially `pds`. Plan a maintenance window: the new Accounts Worker removes the RPC entrypoint used by the old registry. Verify Accounts XRPC first, switch the narrow wildcard route, verify well-known resolution, then remove the old Worker. Do not silently rename or delete existing accounts.

Review [current limitations](../DEVELOPMENT.md) before accepting real users. Account-creation checks write persistent identity data.
