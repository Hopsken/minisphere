# Handle Registry

The Handle Registry is a Hono Cloudflare Worker with D1. It will register AT Protocol handles independently of the PDS domain. The initial project provides the Worker, database schema, migration workflow, health endpoint, and test harness; registration and resolution APIs are not implemented yet.

## Data ownership

The Handle Registry owns the mapping from a registered handle to its DID. D1 contains the handle, DID, and local registration timestamp.

## Database

Create the production D1 database and copy its ID into `wrangler.jsonc`:

```sh
pnpm --filter @minisphere/handle-registry exec wrangler d1 create minisphere-handle-registry
```

The Drizzle schema is in `src/db/schema.ts`. Migration commands require a short, descriptive name:

```sh
pnpm --filter @minisphere/handle-registry db:generate add-handle-index
pnpm --filter @minisphere/handle-registry db:migrate:local
pnpm --filter @minisphere/handle-registry db:migrate:remote
```

The remote migration command changes deployed data and requires Cloudflare credentials.

## Development

```sh
pnpm dev:handle-registry
pnpm turbo test typecheck build --filter=@minisphere/handle-registry
```

The local Handle Registry listens on port `8789`. Its inspector port is assigned dynamically.

`pnpm setup:local` generates Worker types and applies local D1 migrations for the complete stack.
