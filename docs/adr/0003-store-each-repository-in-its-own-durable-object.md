# 0003. Store each repository in its own Durable Object

## Status

Accepted

## Context

An AT Protocol repository is a signed Merkle tree that changes one commit at a time. Commits for one DID must be serialized and atomic. Commits for different DIDs are independent. One shared database would need locking for each repository, and a failed write could leave blocks without a matching root.

## Decision

- One SQLite Durable Object hosts one DID's repository and uses the DID as its name.
- `@minisphere/repo-do` owns `RepoDO`, its schema, and its migrations. The PDS owns global state (accounts, invitations, signing-key reservations) in D1.
- Repository creation and every commit write blocks, the new root, and blob reference changes in one transaction. Repository creation also stores the signing key in that transaction.
- Writes to one repository run in one queue that covers the precondition checks, signing, and the commit.

## Consequences

- Writes scale per DID without cross-repository locks.
- Queries across repositories need an index outside the Durable Objects. There is none yet.
- Repository storage and global account state have separate migrations.

## References

- [`packages/repo-do`](../../packages/repo-do/README.md)
