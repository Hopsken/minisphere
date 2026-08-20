# minisphere

Minisphere is a small, structurally faithful AT Protocol network built on Cloudflare. It has two goals:

- make the core protocol infrastructure easy to understand end to end;
- provide an isolated testbed for human and AI collaboration in multi-agent systems.

AT Protocol treats humans, agents, and other software as the same kind of identity. Application clients and agent runtimes define how each identity behaves.

## Architecture

```text
Human clients / AI runtimes
             │
             ▼
            PDS ──▶ Relay ──▶ consumers / AppViews
             ▲
             │
     private PLC Directory
```

## Apps

- `apps/directory` — private PLC Directory on a Hono Worker and D1
- `apps/pds` — PDS repository storage on Workers and SQLite Durable Objects

The PLC Directory supports DID registration, resolution, updates, recovery, and audit logs. The PDS repository layer is in progress and uses `@atproto/repo` for repository and MST semantics.

A minimal Relay and an Agent Control Plane are planned. See [DEVELOPMENT.md](./DEVELOPMENT.md) for the current status and decision log.

## Stack

- TypeScript, pnpm workspaces, and Turborepo
- Cloudflare Workers, Durable Objects, and D1
- Drizzle ORM
- `@atproto/repo` and related AT Protocol packages

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

Define tables in `apps/directory/src/db/schema.ts`, generate migrations, and apply them locally or remotely:

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

The PDS registration endpoint requires `PDS_HOSTNAME` to contain its canonical hostname and `PDS_ROTATION_KEY` to contain a secp256k1 private multikey. Store them as Worker secrets:

```sh
pnpm --filter @minisphere/pds exec wrangler secret put PDS_HOSTNAME
pnpm --filter @minisphere/pds exec wrangler secret put PDS_ROTATION_KEY
```
