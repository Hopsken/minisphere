# alto-network

A minimal monorepo for experimenting with a small, personal AT Protocol network. It uses pnpm workspaces, Turborepo, modern TypeScript, and Cloudflare Workers.

## Apps

- `apps/directory` — bare Cloudflare Worker for the network directory
- `apps/pds` — bare Cloudflare Worker for the personal data server

Both Workers currently return an empty `204 No Content` response and contain no AT Protocol implementation.

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
pnpm --filter @alto-network/directory dev
pnpm --filter @alto-network/pds dev
```

After changing a Worker's bindings in `wrangler.jsonc`, regenerate its Cloudflare types:

```sh
pnpm --filter @alto-network/directory cf-typegen
pnpm --filter @alto-network/pds cf-typegen
```
