# Handle Registry

The Handle Registry is a Hono Cloudflare Worker with D1. It registers AT Protocol handles independently of the PDS domain and serves HTTPS handle resolution.

## Protocol role

A PLC DID document can claim a handle in `alsoKnownAs`, but that claim does not prove that the handle owner controls the DID. AT Protocol clients verify the other direction by requesting:

```text
https://<handle>/.well-known/atproto-did
```

The Worker routes wildcard subdomains under its configured domain and returns the registered DID as plain text. Unknown handles return `404`.

## Data ownership

The Handle Registry owns the mapping from a registered handle to its DID. D1 contains the handle, DID, and local registration timestamp.

The PLC Directory remains the source of truth for the DID document and its `alsoKnownAs` claim. The PDS owns account and authentication state and does not duplicate the handle.

## Registration

`HandleRegistryEntrypoint` is a named Worker RPC entrypoint used by the Control Plane. It provides:

- `exists(handle)` to check current availability;
- `register(input)` to validate and register one label directly under the configured domain.

Registration validates the handle and DID syntax and rejects reserved first labels. Normal registration rejects an existing handle. The administrative Control Plane flow uses `override: true` for the final write after its availability check, so the write is an atomic D1 upsert. The entrypoint is available only through a Worker service binding; there is no public registration HTTP route.

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

## Configuration

`DOMAIN` is the handle suffix accepted by the RPC entrypoint. The production Wrangler configuration also routes `*.r2d2.party/*` to this Worker. Keep the route and `DOMAIN` value synchronized when changing the registry domain.

## Development

```sh
pnpm dev:handle-registry
pnpm turbo test typecheck build --filter=@minisphere/handle-registry
```

The local Handle Registry listens on port `8789`. Its inspector port is assigned dynamically.

`pnpm setup:local` generates Worker types and applies local D1 migrations for the complete stack.
