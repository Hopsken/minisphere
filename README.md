# minisphere

A minimal monorepo for experimenting with a small, personal AT Protocol network. It uses pnpm workspaces, Turborepo, modern TypeScript, and Cloudflare Workers.

## Apps

- `apps/directory` — Hono Cloudflare Worker backed by D1 through Drizzle ORM
- `apps/pds` — Cloudflare Worker backed by SQLite Durable Objects through Drizzle ORM

The directory currently exposes a minimal JSON root and a database-backed health check. The PDS keeps its empty `204 No Content` response and exposes a database-backed health check at `/_health`. Neither contains AT Protocol implementation yet.

## Requirements

- Node.js 22 or later
- pnpm 11

## Setup

```sh
pnpm install
```

## Commands

```sh
pnpm dev          # Run both Workers locally
pnpm build        # Build both Workers without deploying
pnpm typecheck    # Type-check all workspace packages
pnpm lint         # Lint the repository
pnpm format       # Format the repository
pnpm check        # Run all repository checks
pnpm deploy       # Deploy both Workers to Cloudflare
```

Run a command for only one app with a pnpm filter:

```sh
pnpm --filter @minisphere/directory dev
pnpm --filter @minisphere/pds dev
```

After changing a Worker's bindings in `wrangler.jsonc`, regenerate its Cloudflare types:

```sh
pnpm --filter @minisphere/directory cf-typegen
pnpm --filter @minisphere/pds cf-typegen
```

## Directory database

Create the production D1 database, then copy the returned database ID into `apps/directory/wrangler.jsonc`:

```sh
pnpm --filter @minisphere/directory exec wrangler d1 create minisphere-directory
```

Define tables in `apps/directory/src/schema.ts`, generate migrations, and apply them locally or remotely:

```sh
pnpm --filter @minisphere/directory db:generate
pnpm --filter @minisphere/directory db:migrate:local
pnpm --filter @minisphere/directory db:migrate:remote
```

The remote command changes the deployed database and requires configured Cloudflare credentials.

## PDS database

The PDS stores one SQLite database in each `PdsDurableObject` instance. Define tables in `apps/pds/src/db/schema.ts`, then generate bundled migrations:

```sh
pnpm --filter @minisphere/pds db:generate
```

The Durable Object applies pending migrations before it accepts requests. Wrangler creates the SQLite-backed Durable Object namespace during the first deployment.
