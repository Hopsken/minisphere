# RepoDO

`@minisphere/repo-do` is the DID-scoped repository storage package used by the PDS. One SQLite Durable Object hosts one DID repository and uses the DID as its object name.

The package owns:

- the `RepoDO` implementation;
- the repository signing key stored in Durable Object storage;
- the SQLite storage adapter used by `@atproto/repo`;
- the repository Drizzle schema;
- bundled migrations applied before repository requests are accepted.

Initial repository creation writes the private signing key, initial blocks, and final root metadata in one synchronous Durable Object SQLite transaction. Later commits use the same atomic blocks-and-root boundary. A retry with the same DID and signing key verifies and returns the readable repository; an incomplete repository from the former initialization sequence is rebuilt in one transaction.

`rpcApplyWrites` accepts prepared record writes from the authenticated PDS service. A per-object write queue covers head/record preconditions, ordered MST changes, signing, atomic persistence, and cache publication. Failure releases the queue without publishing an uncommitted head. A cold read never replaces the writer's cached repo. Reads may return the preceding committed snapshot while a write is being prepared.

`swapCommit` and `swapRecord` are checked inside that queue. Record JSON crosses RPC as a string and is decoded with strict Lexicon parsing before CBOR encoding. One batch produces at most one signed commit; unchanged puts and standalone absent deletes are no-ops. Existing blocks are retained for proof readers. Block inserts use 25-row chunks inside the same SQLite transaction as the root update; block reads use 90-CID chunks to stay within the binding limit. The PDS owns transport limits, schema validation, and authorization; this RPC is not a public HTTP interface.

The package also owns `blobs` (CID, object key, size, MIME, temporary expiry) and `record_blobs` (record path, CID, current record revision). The PDS writes bytes to private R2 before calling `rpcRegisterBlob`; registration uses the same write queue as commits. Record preparation checks every modern blob descriptor against local metadata even when Lexicon schema validation is disabled. Blocks, root, and the final reference changes commit together. Only current references allow public reads; a last-reference removal deletes the logical blob metadata. Historical blocks do not retain blob access. `rpcListBlobs` uses current reference revisions for `since` and a distinct CID cursor.

Physical reclamation is deferred: this package has no R2 binding, alarm, scan, or deletion queue. Expired temporary rows and unreferenced R2 objects can remain indefinitely. Unique object generations prevent a future cleanup task for an old object from targeting a new upload. See the PDS README for limits and the cleanup follow-up.

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
