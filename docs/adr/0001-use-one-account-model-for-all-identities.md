# 0001. Use one account model for all AT Protocol identities

## Status

Accepted

## Context

An earlier model let one Better Auth user own and manage several related DID accounts. That is a Minisphere management policy, not an Entryway account model. It made onboarding, OAuth subject selection, and failure recovery depend on owner relationships.

## Decision

- Every AT Protocol identity uses the same account model. The system stores no account type or classification.
- One Accounts user has at most one AT Protocol account, with one permanent username and one immutable DID.
- Clients and runtimes decide how an account behaves. Accounts does not.

## Consequences

- OAuth consent binds exactly one DID. The browser never chooses a DID.
- A person who needs several identities needs several Accounts users.
- Managed or agent accounts need no special schema. Any future grouping must be a separate feature outside the account model.

## References

- [Accounts README](../../apps/accounts/README.md)
