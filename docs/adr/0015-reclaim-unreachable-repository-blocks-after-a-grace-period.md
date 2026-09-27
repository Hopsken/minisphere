# 0015. Reclaim unreachable repository blocks after a grace period

## Status

Accepted

## Context

Each commit stores the blocks that its root newly reaches and lists the blocks it stopped referencing in `removedCids`. `RepoDO` has kept every block, so a repository grows with its history instead of its contents. A Durable Object holds at most 10 GB, and the bytes of deleted and replaced records stay in storage.

Three facts constrain deletion:

- `removedCids` is not a reachability result. When one path stops referencing a record, its CID is listed even if another path holds a record with identical content. Deleting every listed block, as the reference PDS does, would break that other record.
- Streamed reads such as `getRepo` and `sync.getRecord` keep reading the root they started from while later commits land. Blocks removed by those commits must outlive such reads.
- `getRepo?since=` relies on each reachable block's `rev` being the last commit that made it reachable.

## Decision

- A commit records each CID in `removedCids` as a reclamation candidate, with the current time, in the commit transaction. Recording a candidate again moves its time forward.
- An alarm reclaims candidates that are at least one hour old. It walks the current tree, deletes the candidates it does not reach, and drops the rest. A later commit that removes them records them again.
- Reclamation runs in the repository's write queue, so no commit changes the tree between the walk and the deletion.
- An active repository runs reclamation at most once an hour, so a block is deleted one to two hours after it becomes unreachable.
- The migration that introduces reclamation records every existing block as a candidate that is due immediately. Existing repositories are then reclaimed by the same check. No read can span the migration, because migrations run before a new Durable Object instance accepts requests.
- Outbox retries and reclamation share the Durable Object's single alarm, which is set for whichever is due first.

## Consequences

- A repository's storage is bounded by its current tree plus about two hours of removed blocks. Deleted and replaced records are physically removed within that window.
- Reachability comes from the tree itself, not from reference counts or a record index that could drift from it. Each reclamation reads every MST node, but not the records, and writes wait while it runs.
- A read that lasts longer than an hour can fail with a missing block.
- `getRepo?since=` stays correct. Reclamation never touches a reachable block or its `rev`, and a block that becomes reachable again is rewritten with the new commit's revision.
- Firehose events carry their own blocks and are unaffected.
- An existing repository is reclaimed after its Durable Object next starts, which requires a request.
- `getRepo` could now stream the block table instead of walking the tree. That is a separate change.

## References

- [Issue #37](https://github.com/Hopsken/minisphere/issues/37)
- [`CoreStorage.applyCommit`](../../packages/repo-do/src/core/storage.ts) and [the repository export](../../packages/repo-do/src/export.ts)
- `DataDiff` in `@atproto/repo`, which computes `removedCids`
- [ADR 0003](./0003-store-each-repository-in-its-own-durable-object.md) and [ADR 0012](./0012-sequence-repository-events-in-one-durable-object.md)
