# minisphere

Minisphere is a small, structurally faithful AT Protocol network built on Cloudflare. It makes the core protocol infrastructure understandable end to end and provides an isolated testbed for human and AI collaboration.

Every AT Protocol identity uses the same account model. Clients and runtimes define how an account behaves.

## Architecture

```text
Members / clients ──▶ Accounts ──▶ PDS ──▶ Relay ──▶ consumers / AppViews
        Handle resolution ──┘          │
                                      ▼
                              configured PLC Directory
```

## Workspace

### Apps

- [`apps/accounts`](./apps/accounts/README.md) — system authentication server and React SPA on Better Auth, Hono, and D1
- [`apps/directory`](./apps/directory/README.md) — optional private PLC Directory on a Hono Worker and D1; deployments can use `https://plc.directory` instead
- [`apps/pds`](./apps/pds/README.md) — PDS XRPC, account, authentication, and repository routing Worker

### Examples

- [`examples/town`](./examples/town/README.md) — minimal external AT Protocol OAuth browser client

### Packages

- [`packages/atproto-oauth-provider`](./packages/atproto-oauth-provider/README.md) — Worker-compatible AT Protocol OAuth authorization-server plugin for Better Auth
- [`packages/hono-utils`](./packages/hono-utils/README.md) — shared Hono request-validation helpers
- [`packages/repo-do`](./packages/repo-do/README.md) — DID-scoped repository Durable Object, schema, and migrations

A minimal Relay is planned.

## Requirements

- Node.js 24
- pnpm 11

## Setup

```sh
pnpm install
pnpm setup:local
```

The setup command validates the fixed local topology, creates each missing `.env` and `.dev.vars` file from its project template, generates Worker types, and applies local database migrations. It preserves existing developer-owned files.

Shared external dependencies, core toolchain packages, and direct `@atcute/*` dependencies are defined in the pnpm catalog in `pnpm-workspace.yaml`. Workspace manifests reference them with the `catalog:` protocol, and `pnpm add` prefers matching catalog entries.

The example Worker secrets are for local development only. See the [deployment guide](./docs/DEPLOYMENT.md) for production configuration.

## Commands

```sh
pnpm dev              # Run Town, PLC Directory, PDS, and Accounts
pnpm dev:atproto      # Run PLC Directory, PDS, and Accounts
pnpm dev:accounts     # Run Accounts and its PDS dependency
pnpm dev:pds          # Run the PDS and Directory
pnpm dev:directory    # Run only the Directory
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
pnpm turbo build --filter=@minisphere/accounts
```

Use a pnpm filter for an explicit project-local write operation:

```sh
pnpm --filter @minisphere/pds db:generate add-session-index
pnpm --filter @minisphere/pds db:migrate:local
```

## Continuous integration

GitHub Actions runs `pnpm check` for pull requests, merge queue entries, and pushes to `main`. The `Checks` status must be required in the `main` branch rules before it can block a pull request merge.

## Status

Minisphere is in development. Not yet implemented:

- a deployed end-to-end account-creation test;
- confidential OAuth clients (`private_key_jwt`) and OAuth permission sets (`include:`);
- PDS session methods, repository export, and repository event subscriptions;
- physical blob reclamation and storage quotas;
- the Relay.

## Documentation

- [Architecture Decision Records](./docs/adr/README.md)
- [Local development](./docs/LOCAL_DEVELOPMENT.md)
- [Deployment](./docs/DEPLOYMENT.md)
- [Coding style](./docs/CODING_STYLE.md)

Each project's README describes its interface, configuration, and commands.
