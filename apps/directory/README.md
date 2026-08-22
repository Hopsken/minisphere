# PLC Directory

The Directory is a private `did:plc` service implemented as a Hono Cloudflare Worker with D1. It validates and stores the append-only PLC operation log, derives current DID state, and serves DID documents and audit data.

## Data ownership

The Directory is the source of truth for PLC DID operations and derived DID documents. D1 contains:

- registered DIDs;
- ordered PLC operations and CIDs;
- nullification state;
- the local receive timestamp used by the audit log.

## Database

Create the production D1 database and copy its ID into `wrangler.jsonc`:

```sh
pnpm --filter @minisphere/directory exec wrangler d1 create minisphere-directory
```

The Drizzle schema is in `src/db/schema.ts`. Migration commands require a short, descriptive name:

```sh
pnpm --filter @minisphere/directory db:generate add-operation-index
pnpm --filter @minisphere/directory db:migrate:local
pnpm --filter @minisphere/directory db:migrate:remote
```

The remote migration command changes deployed data and requires Cloudflare credentials.

## Development

```sh
pnpm dev:directory
pnpm turbo test typecheck build --filter=@minisphere/directory
```

`pnpm setup:local` generates Worker types and applies local D1 migrations for the complete stack.
