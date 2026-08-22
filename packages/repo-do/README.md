# RepoDO

`@minisphere/repo-do` is the DID-scoped repository storage package used by the PDS. One SQLite Durable Object hosts one DID repository and uses the DID as its object name.

The package owns:

- the `RepoDO` implementation;
- the repository signing key stored in Durable Object storage;
- the SQLite storage adapter used by `@atproto/repo`;
- the repository Drizzle schema;
- bundled migrations applied before repository requests are accepted.

The PDS owns global account and refresh-token state. That data does not belong in `RepoDO`.

## Migrations

Define repository tables in `src/db/schema.ts` and generate a bundled migration with a descriptive name:

```sh
pnpm --filter @minisphere/repo-do db:generate add-repo-table
```

Generated migration modules live in `migrations/` and are imported by the Durable Object.

## Development

```sh
pnpm --filter @minisphere/repo-do typecheck
```
