# minisphere

Minisphere is a small, structurally faithful AT Protocol network built on Cloudflare. It makes the core protocol infrastructure understandable end to end and provides an isolated testbed for human and AI collaboration.

Every AT Protocol identity uses the same account model. Clients and runtimes define how an account behaves.

## Architecture

```text
Operators ──▶ Control Plane ──▶ PDS ──▶ Relay ──▶ consumers / AppViews
                                 ▲
Clients / runtimes ──────────────┘
                                 │
                        private PLC Directory
```

## Workspace

### Apps

- [`apps/directory`](./apps/directory/README.md) — private PLC Directory on a Hono Worker and D1
- [`apps/pds`](./apps/pds/README.md) — PDS XRPC, account, authentication, and repository routing Worker
- [`apps/control-plane`](./apps/control-plane/README.md) — Cloudflare Access-protected account dashboard and API
- [`apps/handle-registry`](./apps/handle-registry/README.md) — AT Protocol handle registry on a Hono Worker and D1

### Packages

- [`packages/hono-utils`](./packages/hono-utils/README.md) — shared Hono request-validation helpers
- [`packages/repo-do`](./packages/repo-do/README.md) — DID-scoped repository Durable Object, schema, and migrations

A minimal Relay is planned.

## Requirements

- Node.js 22 or later
- pnpm 11

## Setup

```sh
pnpm install
cp apps/control-plane/.env.example apps/control-plane/.env
cp apps/control-plane/.dev.vars.example apps/control-plane/.dev.vars
cp apps/pds/.dev.vars.example apps/pds/.dev.vars
pnpm setup:local
```

The example Worker secrets are for local development only. Production secrets are managed with Wrangler and must use different values.

## Commands

```sh
pnpm dev:control      # Run the Control Plane and its dependencies
pnpm dev:pds          # Run the PDS and Directory
pnpm dev:directory    # Run only the Directory
pnpm dev:handle-registry # Run only the Handle Registry
pnpm check            # Run all repository checks through Turbo
pnpm test             # Test all workspace projects
pnpm typecheck        # Type-check all workspace projects
pnpm build            # Build all apps without deploying
pnpm lint             # Lint the repository
pnpm lint:fix         # Fix supported lint findings
pnpm format           # Format the repository
pnpm deploy           # Migrate and deploy the production stack in dependency order
```

Use a Turbo filter for a targeted read-only task:

```sh
pnpm turbo test typecheck --filter=@minisphere/pds
pnpm turbo build --filter=@minisphere/control-plane
```

Use a pnpm filter for an explicit project-local write operation:

```sh
pnpm --filter @minisphere/pds db:generate add-session-index
pnpm --filter @minisphere/pds db:migrate:local
```

## Documentation

- [Development status and decision log](./DEVELOPMENT.md)
- [Coding style](./docs/CODING_STYLE.md)
- [Architecture Decision Records](./docs/adr/README.md)

Project-specific architecture, setup, bindings, database, and deployment instructions live in each project's README.
