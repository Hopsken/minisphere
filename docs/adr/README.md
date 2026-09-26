# Architecture Decision Records

Each ADR records one durable decision and the reason for it. Project READMEs describe the resulting interfaces and configuration.

| ADR | Decision |
| --- | --- |
| [0001](./0001-use-one-account-model-for-all-identities.md) | Use one account model for all AT Protocol identities |
| [0002](./0002-assign-each-fact-to-one-owning-service.md) | Assign each fact to one owning service |
| [0003](./0003-store-each-repository-in-its-own-durable-object.md) | Store each repository in its own Durable Object |
| [0004](./0004-create-accounts-through-the-entryway-flow.md) | Create accounts through the Entryway flow |
| [0005](./0005-make-accounts-the-oauth-authorization-server.md) | Make Accounts the OAuth authorization server |
| [0006](./0006-keep-private-keys-in-server-managed-custody.md) | Keep private keys in server-managed custody |
| [0007](./0007-keep-production-configuration-in-the-cloudflare-dashboard.md) | Keep production configuration in the Cloudflare Dashboard |
| [0008](./0008-select-one-plc-directory-without-fallback.md) | Select one PLC Directory without fallback |
| [0009](./0009-read-worker-bindings-from-the-global-env.md) | Read Worker bindings from the global `env` |
| [0010](./0010-test-through-public-interfaces.md) | Test through public interfaces |
| [0011](./0011-sign-plc-updates-only-with-the-lowest-priority-key.md) | Sign PLC updates only with the lowest-priority key |

## Writing an ADR

Add a numbered file with a short title in imperative form, for example `0012-emit-repository-events-through-the-relay.md`. Use these sections:

1. **Status** — Proposed, Accepted, Superseded by ADR NNNN, or Rejected.
2. **Context** — the forces and constraints that require a decision.
3. **Decision** — what we do, stated as rules.
4. **Consequences** — what becomes easier, what becomes harder, and the risks.
5. **References** — code, specifications, or related ADRs.

Do not rewrite an accepted ADR when the decision changes. Add a new ADR and mark the old one as superseded.
