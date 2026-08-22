# PDS

The PDS is a Hono Cloudflare Worker that exposes AT Protocol XRPC routes. It owns account and authentication state and routes each DID to its repository Durable Object.

## Data ownership and bindings

- PDS D1 stores accounts, password hashes, and refresh-token records.
- PDS KV stores short-lived account invite codes.
- [`@minisphere/repo-do`](../../packages/repo-do/README.md) owns repository data and repository signing keys.
- The private `DIRECTORY` service binding receives PLC genesis operations.
- `PdsControlPlane.generateInviteCode()` is a named RPC entrypoint for the Control Plane.

## D1 and KV

Create the production D1 database and KV namespace, then copy their IDs into `wrangler.jsonc`:

```sh
pnpm --filter @minisphere/pds exec wrangler d1 create minisphere-pds
pnpm --filter @minisphere/pds exec wrangler kv namespace create minisphere-pds-kv
```

The account schema is in `src/db/schema.ts`:

```sh
pnpm --filter @minisphere/pds db:generate add-account-column
pnpm --filter @minisphere/pds db:migrate:local
pnpm --filter @minisphere/pds db:migrate:remote
```

## Secrets

- `PDS_HOSTNAME` — canonical PDS hostname
- `PDS_JWT_SECRET` — at least 32 random bytes used for password-session JWTs
- `PDS_ROTATION_KEY` — secp256k1 private multikey used to sign PLC operations

```sh
pnpm --filter @minisphere/pds exec wrangler secret put PDS_HOSTNAME
pnpm --filter @minisphere/pds exec wrangler secret put PDS_JWT_SECRET
pnpm --filter @minisphere/pds exec wrangler secret put PDS_ROTATION_KEY
```

## Development

```sh
pnpm --filter @minisphere/pds dev
pnpm --filter @minisphere/pds test
pnpm --filter @minisphere/pds typecheck
pnpm --filter @minisphere/pds build
```

Run `pnpm --filter @minisphere/pds cf-typegen` after a binding or bound Worker interface changes.
