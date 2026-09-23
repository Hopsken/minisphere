# PLC Directory

The Directory is a private `did:plc` service implemented as a Hono Cloudflare Worker with D1. It validates and stores the append-only PLC operation log, derives current DID state, and serves DID documents and audit data.

## Data ownership

The Directory is the source of truth for PLC DID operations and derived DID documents. D1 contains:

- registered DIDs;
- ordered PLC operations and CIDs;
- nullification state;
- the local receive timestamp used by the audit log.

## Database

Create the production D1 database and copy its ID into `wrangler.jsonc`:

```sh
pnpm --filter @minisphere/directory exec wrangler d1 create minisphere-directory
```

The Drizzle schema is in `src/db/schema.ts`. Migration commands require a short, descriptive name:

```sh
pnpm --filter @minisphere/directory db:generate add-operation-index
pnpm --filter @minisphere/directory db:migrate:local
pnpm --filter @minisphere/directory db:migrate:remote
```

The remote migration command changes deployed data and requires Cloudflare credentials.

Configure the production custom domain in the Worker's Cloudflare **Settings → Domains & Routes**. Wrangler leaves Dashboard-managed routes in place. See [Workers Builds configuration](../../docs/LOCAL_DEVELOPMENT.md#production-and-workers-builds).

## Development

```sh
pnpm dev:directory
pnpm turbo test typecheck build --filter=@minisphere/directory
```

The local Directory listens on port `8788`. Its inspector port is assigned dynamically.

`pnpm setup:local` generates Worker types and applies local D1 migrations for the complete stack.

## Copy a genesis operation

For a DID with no updates, copy its signed genesis without private keys or Cloudflare credentials:

```sh
pnpm --filter @minisphere/directory migrate:genesis \
  --from https://old-plc.example.com --to https://plc.directory --did did:plc:YOUR_DID
```

This is read-only. Review the target, handle, PDS endpoint, and keys in the output, then repeat with `--apply` to publish. Public PLC records are public and persistent. The script does not support directories behind additional access authentication.

Both directories must expose `/DID/log/audit`. The script validates the genesis signature, DID, and CID; rejects updates, recovery history, and tombstones; skips an identical target; and verifies the result after submission. After a timeout, rerun without `--apply` to check the target before retrying. Original audit timestamps are not preserved.

Keep the source available and pause identity updates during migration. Copy and verify every required DID before changing `PLC_DIRECTORY` in Accounts, PDS, and Town. This does not move repository data or update handles, PDS endpoints, or keys. Accounts with later operations need a separate full-history migration.
