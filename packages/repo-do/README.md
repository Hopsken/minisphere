# RepoDO

`@minisphere/repo-do` is the DID-scoped repository storage package used by the PDS. One SQLite Durable Object hosts one DID repository and uses the DID as its object name.

The package owns:

- the `RepoDO` implementation;
- the repository signing key stored in Durable Object storage;
- the SQLite storage adapter used by `@atproto/repo`;
- the repository Drizzle schema;
- bundled migrations applied before repository requests are accepted.

Initial repository creation writes the private signing key, initial blocks, and final root metadata in one synchronous Durable Object SQLite transaction. Later commits use the same atomic blocks-and-root boundary. A retry with the same DID and signing key verifies and returns the readable repository; an incomplete repository from the former initialization sequence is rebuilt in one transaction.

The PDS owns global account and refresh-token state. That data does not belong in `RepoDO`.

Public reads use the existing `@atproto/repo` MST and proof APIs. Collection enumeration reads MST leaves without decoding record bodies. Ascending pagination seeks to the cursor; descending pagination scans the target collection up to the cursor, retaining only one page plus a lookahead because the library has no reverse iterator. Large descending scans may need a record-path index in a later change. `@atproto/lex-json` converts record links and bytes to plain JSON, and record-proof CARs cross the Durable Object RPC boundary as streams.

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
