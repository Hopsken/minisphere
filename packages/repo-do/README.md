# RepoDO

`@minisphere/repo-do` stores AT Protocol repositories for the PDS. Each repository lives in its own SQLite Durable Object, named by its DID.

The package owns the repository records, commits, repository signing key, and blob references, together with their schema and migrations. The PDS owns global account state and calls `RepoDO` only through Durable Object RPC; it is not a public HTTP interface.

Guarantees the PDS relies on:

- Repository creation and every commit are atomic: blocks, the new root, and blob reference changes are written together or not at all.
- Writes to one repository run one at a time. `swapCommit` and `swapRecord` are checked inside that queue.
- A blob can be read only while a current record references it.
- Creating a repository again with the same DID and signing key succeeds; a different signing key is rejected.
- Every commit records its firehose `#commit` event in the same transaction. A repository's events reach the sequencer in commit order, at least once, even if the sequencer is unavailable when the write commits. The host Worker must bind that sequencer as `SEQUENCER`, implementing `RepoEventSequencer`.

## Migrations

Define tables in `src/db/schema.ts`, then generate a named migration:

```sh
pnpm --filter @minisphere/repo-do db:generate add-repo-table
```

The Durable Object applies the generated migrations in `migrations/` before it accepts requests.

## Development

```sh
pnpm --filter @minisphere/repo-do typecheck
```
