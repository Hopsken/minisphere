# 0002. Assign each fact to one owning service

## Status

Accepted

## Context

Account data spans Accounts, the PDS, repository storage, and the PLC Directory. Copies of the same fact in several services drift apart and make it unclear which value wins after a partial failure.

## Decision

Each fact has one owner:

| Service | Owns | Does not own |
| --- | --- | --- |
| Accounts | Users, primary authentication, usernames, hosted handle-to-DID mappings, PLC rotation keys, OAuth authorization and token signing | Repositories, DID documents |
| PDS | Hosted account records, invitations, repository signing-key reservations, DPoP replay state, blob bytes | Usernames, handle uniqueness, passwords |
| `@minisphere/repo-do` | Repository records, commits, the repository signing key, and blob references, per DID | Global account state |
| PLC Directory | DID operation logs and DID documents | Anything else |

- A service stores a reference to data that another service owns, never a copy.
- A PLC `alsoKnownAs` entry is a handle claim, not proof. Accounts answers the reverse lookup from its own active mapping.

## Consequences

- Accounts serves handle resolution directly. The PDS does not publish handle mappings or enforce handle uniqueness.
- Reads that combine data from several services must call each owner.
- A new table or column must name its owner. If another service owns the data, store a reference.

## References

- [ADR 0003](./0003-store-each-repository-in-its-own-durable-object.md)
- [Coding style: Databases and migrations](../CODING_STYLE.md#databases-and-migrations)
