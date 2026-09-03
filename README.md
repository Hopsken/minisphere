# minisphere

Minisphere is a small, structurally faithful AT Protocol network built on Cloudflare. It makes the core protocol infrastructure understandable end to end and provides an isolated testbed for human and AI collaboration.

Every AT Protocol identity uses the same account model. Clients and runtimes define how an account behaves.

## Architecture

```text
Operators / clients ──▶ Accounts ──▶ PDS ──▶ Relay ──▶ consumers / AppViews
                           ▲          │
                           │          ▼
Handle requests ──▶ Handle Registry  private PLC Directory
```

## Workspace

### Apps

- [`apps/accounts`](./apps/accounts/README.md) — system authentication server and React SPA on Better Auth, Hono, and D1
- [`apps/directory`](./apps/directory/README.md) — private PLC Directory on a Hono Worker and D1
- [`apps/pds`](./apps/pds/README.md) — PDS XRPC, account, authentication, and repository routing Worker
- [`apps/control-plane`](./apps/control-plane/README.md) — Cloudflare Access-protected account dashboard and API
- [`apps/handle-registry`](./apps/handle-registry/README.md) — stateless AT Protocol HTTPS handle verification wrapper

### Examples

- [`examples/town`](./examples/town/README.md) — minimal external AT Protocol OAuth browser client

### Packages

- [`packages/atproto-oauth-provider`](./packages/atproto-oauth-provider/README.md) — Worker-compatible AT Protocol OAuth authorization-server plugin for Better Auth
- [`packages/hono-utils`](./packages/hono-utils/README.md) — shared Hono request-validation helpers
- [`packages/repo-do`](./packages/repo-do/README.md) — DID-scoped repository Durable Object, schema, and migrations

A minimal Relay is planned.

## Requirements

- Node.js 22 or later
- pnpm 11

## Setup

```sh
pnpm install
pnpm setup:local
```

The setup command validates the fixed local topology, creates each missing `.env` and `.dev.vars` file from its project template, generates Worker types, and applies local database migrations. It preserves existing developer-owned files.

Shared external dependencies, core toolchain packages, and direct `@atcute/*` dependencies are defined in the pnpm catalog in `pnpm-workspace.yaml`. Workspace manifests reference them with the `catalog:` protocol, and `pnpm add` prefers matching catalog entries.

The example Worker secrets are for local development only. Production secrets are managed with Wrangler and must use different values.

## Commands

```sh
pnpm dev              # Run Town, PLC Directory, PDS, Accounts, and Handle Registry
pnpm dev:atproto      # Run PLC Directory, PDS, Accounts, and Handle Registry
pnpm dev:accounts     # Run Accounts and its PDS dependency
pnpm dev:control      # Run the Control Plane and its dependencies
pnpm dev:pds          # Run the PDS and Directory
pnpm dev:directory    # Run only the Directory
pnpm dev:handle-registry # Run the Handle Registry and its dependencies
pnpm dev:town         # Run Town with its current local configuration
pnpm dev:town:local   # Run Town and the complete local AT Protocol service group
pnpm check            # Run all repository checks through Turbo
pnpm test             # Test all workspace projects
pnpm typecheck        # Type-check all workspace projects
pnpm build            # Build all apps without deploying
pnpm lint             # Lint the repository
pnpm lint:fix         # Fix supported lint findings
pnpm format           # Format the repository
pnpm deploy           # Migrate and deploy the production workspace
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

## Continuous integration

GitHub Actions runs `pnpm check` for pull requests, merge queue entries, and pushes to `main`. The `Checks` status must be required in the `main` branch rules before it can block a pull request merge.

## Documentation

- [Accounts Entryway product requirements](./docs/product/accounts-entryway.md)
- [Local development environment](./docs/LOCAL_DEVELOPMENT.md)
- [Development status and decision log](./DEVELOPMENT.md)
- [Coding style](./docs/CODING_STYLE.md)
- [Architecture Decision Records](./docs/adr/README.md)

Project-specific architecture, setup, bindings, database, and deployment instructions live in each project's README.
