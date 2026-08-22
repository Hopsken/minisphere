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
```

## Commands

```sh
pnpm dev          # Run all apps locally
pnpm build        # Build all apps without deploying
pnpm typecheck    # Type-check all workspace projects
pnpm lint         # Lint the repository
pnpm format       # Format the repository
pnpm check        # Run all repository checks
pnpm deploy       # Deploy all Workers
```

Use a pnpm filter to run one project's command:

```sh
pnpm --filter @minisphere/control-plane dev
pnpm --filter @minisphere/pds test
pnpm --filter @minisphere/repo-do typecheck
```

## Documentation

- [Development status and decision log](./DEVELOPMENT.md)
- [Coding style](./docs/CODING_STYLE.md)
- [Architecture Decision Records](./docs/adr/README.md)

Project-specific architecture, setup, bindings, database, and deployment instructions live in each project's README.
