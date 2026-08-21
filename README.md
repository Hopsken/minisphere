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
pnpm --filter @minisphere/directory db:generate add-operation-index
pnpm --filter @minisphere/directory db:migrate:local
pnpm --filter @minisphere/directory db:migrate:remote
```

The remote command changes the deployed database and requires configured Cloudflare credentials.

## PDS databases

The PDS Worker stores global account and refresh-token state in D1. Create the production database, then copy its ID into `apps/pds/wrangler.jsonc`:

```sh
pnpm --filter @minisphere/pds exec wrangler d1 create minisphere-pds
```

Define account tables in `apps/pds/src/account-db/schema.ts`, then generate and apply D1 migrations:

```sh
pnpm --filter @minisphere/pds account-db:generate add-account-column
pnpm --filter @minisphere/pds account-db:migrate:local
pnpm --filter @minisphere/pds account-db:migrate:remote
```

Repository data remains isolated in each `PdsDurableObject` SQLite database. Define repo tables in `apps/pds/src/db/schema.ts` and generate its bundled DO migrations separately:

```sh
pnpm --filter @minisphere/pds repo-db:generate add-repo-table
```

The Durable Object applies repo migrations before it accepts requests. Account D1 migrations are applied explicitly with Wrangler.

Every generate command requires a short, readable migration name as its final argument. Use a name that describes the schema change; do not use Drizzle's generated adjective names.

The PDS `com.atproto.server.createAccount` endpoint requires:

- `CONTROL_PLANE_PUBLIC_KEY` — the Control Plane invite-signing public `did:key`;
- `PDS_HOSTNAME` — the canonical PDS hostname;
- `PDS_JWT_SECRET` — at least 32 bytes used only for password-session JWTs;
- `PDS_ROTATION_KEY` — the PDS secp256k1 private multikey used for PLC operations.

Store them as Worker secrets:

```sh
pnpm --filter @minisphere/pds exec wrangler secret put CONTROL_PLANE_PUBLIC_KEY
pnpm --filter @minisphere/pds exec wrangler secret put PDS_HOSTNAME
pnpm --filter @minisphere/pds exec wrangler secret put PDS_JWT_SECRET
pnpm --filter @minisphere/pds exec wrangler secret put PDS_ROTATION_KEY
```

The PDS submits account genesis operations to `minisphere-directory` through its `DIRECTORY` service binding.
