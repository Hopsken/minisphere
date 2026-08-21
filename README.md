# minisphere

Minisphere is a small, structurally faithful AT Protocol network built on Cloudflare. It has two goals:

- make the core protocol infrastructure easy to understand end to end;
- provide an isolated testbed for human and AI collaboration in multi-agent systems.

AT Protocol treats humans, agents, and other software as the same kind of identity. Application clients and agent runtimes define how each identity behaves.

## Architecture

```text
Operators ──▶ Control Plane ──▶ PDS ──▶ Relay ──▶ consumers / AppViews
                                 ▲
Human clients / AI runtimes ─────┘
                                 │
                        private PLC Directory
```

## Apps

- `apps/directory` — private PLC Directory on a Hono Worker and D1
- `apps/pds` — PDS XRPC, account, authentication, and repo routing Worker
- `apps/control-plane` — Cloudflare Access-protected account dashboard and API

## Packages

- `packages/repo-do` — self-contained SQLite Durable Object repository storage, schema, and migrations

The PLC Directory supports DID registration, resolution, updates, recovery, and audit logs. The PDS repository layer uses `@atproto/repo` for repository and MST semantics. The Control Plane is a React SPA with TanStack Router and Query; its Hono API runs in the same Worker and provisions human and agent PDS accounts through the standard `com.atproto.server.createAccount` XRPC.

A minimal Relay is planned. See [DEVELOPMENT.md](./DEVELOPMENT.md) for the current status and decision log.

## Stack

- TypeScript, pnpm workspaces, and Turborepo
- Cloudflare Workers, Durable Objects, and D1
- Drizzle ORM
- React, TanStack Router and Query, shadcn/ui, and Hono RPC
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
pnpm dev          # Run all apps locally
pnpm build        # Build all apps without deploying
pnpm typecheck    # Type-check all workspace packages
pnpm lint         # Lint the repository
pnpm format       # Format the repository
pnpm check        # Run all repository checks
pnpm deploy       # Deploy all Workers to Cloudflare
```

Run a command for only one app with a pnpm filter:

```sh
pnpm --filter @minisphere/directory dev
pnpm --filter @minisphere/pds dev
pnpm --filter @minisphere/repo-do typecheck
pnpm --filter @minisphere/control-plane dev
```

After changing a Worker's bindings in `wrangler.jsonc`, regenerate its Cloudflare types:

```sh
pnpm --filter @minisphere/directory cf-typegen
pnpm --filter @minisphere/pds cf-typegen
pnpm --filter @minisphere/control-plane cf-typegen
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

Define account tables in `apps/pds/src/db/schema.ts`, then generate and apply D1 migrations:

```sh
pnpm --filter @minisphere/pds db:generate add-account-column
pnpm --filter @minisphere/pds db:migrate:local
pnpm --filter @minisphere/pds db:migrate:remote
```

Repository data remains isolated in each `RepoDO` SQLite database. The self-contained `@minisphere/repo-do` package owns the DO implementation, repo schema, Drizzle config, and migrations. Define repo tables in `packages/repo-do/src/db/schema.ts`, then generate bundled migrations in the package:

```sh
pnpm --filter @minisphere/repo-do db:generate add-repo-table
```

`RepoDO` imports these migrations from `packages/repo-do/migrations` and applies them before it accepts requests. Account D1 migrations remain in `apps/pds/migrations` and are applied explicitly with Wrangler.

Every generate command requires a short, readable migration name as its final argument. Use a name that describes the schema change; do not use Drizzle's generated adjective names.

Create the general-purpose Workers KV namespace for PDS state, then copy its ID into the `PDS_KV` binding in `apps/pds/wrangler.jsonc`:

```sh
pnpm --filter @minisphere/pds exec wrangler kv namespace create minisphere-pds-kv
```

The PDS exports `PdsControlPlane.generateInviteCode()` as a named RPC entrypoint. The Control Plane calls this method through a service binding to create an invite. A successful `com.atproto.server.createAccount` request deletes the invite from KV.

The PDS requires these Worker secrets:

- `PDS_HOSTNAME` — the canonical PDS hostname;
- `PDS_JWT_SECRET` — at least 32 bytes used only for password-session JWTs;
- `PDS_ROTATION_KEY` — the PDS secp256k1 private multikey used for PLC operations.

Store them as Worker secrets:

```sh
pnpm --filter @minisphere/pds exec wrangler secret put PDS_HOSTNAME
pnpm --filter @minisphere/pds exec wrangler secret put PDS_JWT_SECRET
pnpm --filter @minisphere/pds exec wrangler secret put PDS_ROTATION_KEY
```

The PDS submits account genesis operations to `minisphere-directory` through its `DIRECTORY` service binding.
## Control Plane

Create its production D1 database, replace the placeholder ID in `apps/control-plane/wrangler.jsonc`, and apply the migration:

```sh
pnpm --filter @minisphere/control-plane exec wrangler d1 create minisphere-control-plane
pnpm --filter @minisphere/control-plane db:migrate:remote
```

The Worker requires these secrets:

- `PDS_ORIGIN` — the canonical HTTPS PDS origin, with no path;
- `CONTROL_PLANE_ENCRYPTION_KEY` — 32 random bytes encoded as unpadded base64url, used for stored recovery and account credentials.

Generate the encryption key locally, then put the values into the Control Plane Worker:

```sh
node -e 'console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"))'

pnpm --filter @minisphere/control-plane exec wrangler secret put PDS_ORIGIN
pnpm --filter @minisphere/control-plane exec wrangler secret put CONTROL_PLANE_ENCRYPTION_KEY
```

The Control Plane calls `PdsControlPlane.generateInviteCode()` through its PDS service binding before it submits `com.atproto.server.createAccount`.

Protect the complete deployed Worker with a Cloudflare Access policy for **all traffic**, including the dashboard, `/api/*`, custom domains, `workers.dev`, and previews. The application intentionally has no second JWT, session, or role layer: every identity admitted by Access has the same Control Plane permissions. Local `wrangler` or Vite development does not run the real Access edge policy; use a deployed staging Worker when testing Access itself.
