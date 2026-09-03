# Architecture Decision Records

This directory will contain durable architecture decisions. The existing decisions are still recorded in [`DEVELOPMENT.md`](../../DEVELOPMENT.md); they have not yet been converted into individual ADRs.

## Planned format

Use numbered files with a short kebab-case title:

```text
0001-use-one-repository-durable-object-per-did.md
```

Each ADR should contain:

1. **Status** — proposed, accepted, superseded, or rejected
2. **Context** — the forces and constraints that require a decision
3. **Decision** — the selected architecture and ownership boundaries
4. **Consequences** — benefits, costs, risks, and follow-up work
5. **References** — relevant code, issues, or superseded ADRs

Do not rewrite an accepted ADR when a decision changes. Add a new ADR and mark the old one as superseded.

## Decisions to migrate

The current decision log contains these ADR candidates:

- one account model for all AT Protocol identities;
- PLC Directory and PDS data ownership;
- one DID repository per SQLite Durable Object;
- the split between PDS D1 and `@minisphere/repo-do`;
- Accounts ownership of users, primary authentication, usernames, handles, and DIDs, with stateless HTTPS handle verification;
