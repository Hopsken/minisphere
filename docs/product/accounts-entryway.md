# Accounts Entryway Account Model — Product Requirements

- **Status:** Draft for product discovery
- **Scope:** Upstream-provider login, username onboarding, local DID account provisioning, hosted handle registration, and OAuth subject selection
- **Baseline:** `feat/accounts-pds-oauth-integration`
- **Last updated:** 2026-09-01

This is a living product document. It records the target, settled product decisions, unresolved risks, and release criteria. It does not replace product discovery, interaction prototypes, or technical design.

## Product purpose

Minisphere needs an Accounts service that behaves like an AT Protocol Entryway rather than a control plane for owner-managed identities. In the first release, a person authenticates through a configured upstream identity provider. After authentication, the person chooses one permanent local username, receives a hosted handle, and provisions one DID account on the paired PDS.

The resulting Accounts and PDS pair should be usable independently of Minisphere's Control Plane and should preserve a path toward participation in the wider AT Protocol network.

The first release deliberately excludes local registration, passwords, passkeys, and their verification and recovery flows. Those capabilities require separate discovery and must not complicate the initial Entryway onboarding path.

### Problems to solve

The current account model has four product problems:

1. A Better Auth owner can manage multiple related DID users. This is a Minisphere management policy, not a generic Entryway account model.
2. PDS account creation requires a handle, but upstream OIDC and social-login callbacks do not give a new user an opportunity to choose a valid, unique local username.
3. The current flow derives a synthetic email and a managed handle from the same username, which conflates login identity, account name, and AT Protocol identity.
4. Account creation spans Accounts, the PDS, the PLC Directory, the repository store, and handle verification. A partial failure can leave an identity that cannot safely be recreated or completed.

### Value proposition

A new member can sign in through a supported upstream identity provider, complete one clear username step, and receive one working AT Protocol identity. The member does not need to understand owner relationships, DID selection, PDS placement, or Control Plane concepts.

### Release objectives

Objectives are listed in priority order.

1. **One understandable account:** every AT-active Accounts user represents exactly one DID account, with no owner-to-managed-user concept.
2. **Simple upstream onboarding:** every supported upstream identity provider returns a new member to the same required username and DID provisioning flow.
3. **Stable identity:** a DID never changes and a committed username is never reused.
4. **Safe completion:** retries cannot create a second DID or transfer a username to another identity.
5. **Protocol-safe authorization:** a user without an active DID cannot authorize an AT Protocol OAuth client.
6. **Portable product boundary:** the local Accounts and PDS pair does not depend on the Control Plane during onboarding, login, consent, or token issuance.

The first release is successful when all must-have scenarios and release criteria in this document pass. Conversion and latency targets require a measured baseline during discovery; they must be set before production release rather than invented in this document.

## Target users and scenarios

### Primary user profiles

#### Upstream identity-provider member

This member signs in with Google or another OIDC provider. The provider authenticates the member but does not select a Minisphere username. The member expects to complete setup after the provider callback without starting over.

#### Returning AT Protocol member

This member has completed provisioning. They expect normal login to restore access to the same DID and expect OAuth authorization to show that identity without asking them to choose among DIDs.

#### Operator

An operator needs to observe provisioning state and request lifecycle actions. The operator does not choose a user's DID, handle consent, or participate in the real-time OAuth path.

### Core scenarios

#### Upstream identity-provider onboarding

1. The identity provider returns an authenticated member to Accounts.
2. Accounts creates or restores a Better Auth session.
3. A member without an active DID is sent to the required username page.
4. The member selects an available username and confirms the hosted handle.
5. Accounts provisions and activates the DID account.

Accounts may suggest a username from upstream profile data, but it must not claim that username without member confirmation.

#### OAuth request before onboarding is complete

1. An AT Protocol client starts authorization.
2. Accounts authenticates the member.
3. If the member needs a username or is still provisioning, Accounts sends the member through onboarding before consent.
4. Accounts resumes the server-held authorization transaction when it remains valid. If it expired, Accounts fails safely and asks the client to restart.
5. Accounts never creates a code or token without one active DID subject.

#### Returning OAuth authorization

1. Accounts authenticates the member.
2. The consent page displays the single DID, hosted handle, client, and requested scopes.
3. Accounts rechecks the same session and subject when the member submits consent.
4. The member never sees a DID chooser and never submits a DID as form input.

#### Provisioning interruption

1. The member submits an available username.
2. A downstream operation times out or fails.
3. Accounts shows that setup is incomplete and offers a safe retry.
4. The retry continues the same provisioning operation and cannot create a second DID.
5. Once PLC identity creation has occurred, the system recovers forward rather than deleting and recreating the identity.

## Product principles

1. **Authenticate first, onboard once.** Every supported upstream provider converges on one post-authentication account-completion flow.
2. **One principal, one identity.** A user may have no DID while onboarding and exactly one DID after activation. Accounts has no user-to-user ownership model.
3. **Username and DID are permanent.** A committed username and DID are never reassigned. The username produces the initial hosted handle.
4. **The user chooses names, not identifiers.** The member chooses a username. The PDS creates the DID; the browser never supplies or selects one.
5. **Fail closed and recover forward.** Incomplete accounts cannot authorize clients. Irreversible identity operations are completed by retry, not hidden by destructive compensation.
6. **One source of truth per responsibility.** Accounts owns authentication and hosted handle claims. The PDS owns local account state and repository hosting. The PLC Directory owns DID documents.
7. **The Control Plane stays off the critical path.** Operator tooling can request or observe actions, but user-facing identity and authorization do not depend on it.
8. **Protocol security is a release property.** A friendly onboarding experience cannot compensate for incomplete OAuth resource enforcement.

## Settled product decisions

### Account identity

- Better Auth keeps its ordinary internal user ID.
- The DID is a unique, immutable authorization subject assigned by the trusted local provisioning flow.
- A user can have zero DIDs before activation and exactly one DID after activation.
- Existing or external DIDs cannot be imported, claimed, connected, or selected in the first release.
- A DID cannot move to another Better Auth user through a normal product operation.

This is one account aggregate. The internal user ID and DID do not represent an owner and a managed account.

### Username and handle

- The member selects one normalized username.
- The initial hosted handle is derived as `<username>.<PUBLIC_HANDLE_DOMAIN>`.
- Upstream login identities, display names, usernames, and hosted handles are distinct concepts.
- A username reservation may expire before DID creation if onboarding is abandoned.
- As soon as DID creation becomes irreversible, the username is permanently committed to that DID.
- Deactivation or deletion does not make the username reusable.
- Account deletion retains a minimal username and DID tombstone but not deleted upstream-provider links or profile data.
- Custom handles and handle changes require separate future discovery. The first release defines only the initial hosted handle.

### Authorization subject

- Accounts resolves at most one DID subject from the authenticated Better Auth user.
- A missing or inactive subject blocks authorization.
- Consent records the internal user and resolved DID server-side.
- Consent submission verifies the same browser session, resolves the subject again, and requires the DID to match the stored transaction.
- The PDS independently confirms that the DID is local and active before signing an access token.

### Provisioning ownership

Accounts owns the member-facing provisioning journey because it owns the Better Auth session, upstream identity link, and onboarding state. It coordinates a private, idempotent PDS operation. The PDS creates the DID, PLC operation, repository, and local hosting state.

Once DID creation is irreversible, failures are pending work to complete. They are not permission to create another identity. The PDS and Control Plane must not receive upstream-provider credentials or Better Auth session material, or write Better Auth storage directly.

### Target flow

```text
Upstream identity provider ──> Better Auth session ──> username onboarding
                                                       |
                                                       | confirmed username
                                                       v
                                                Accounts Entryway
                                                       |
                                                       | private, idempotent
                                                       | provisioning operation
                                                       v
                                  PLC Directory <── paired local PDS ──> repository
                                                       |
                                                       | one immutable DID
                                                       v
                                      Accounts active user and handle claim
                                                       |
                               +-----------------------+--------------------+
                               |                                            |
                               v                                            v
                     Handle Registry                              AT OAuth consent
                                                                        |
                                                                        v
                                                               private PDS signer

Control Plane ──> asynchronous operator actions only; never a dependency
                  of login, onboarding, consent, or token issuance
```

### Service ownership

| Service | Owns | Does not own |
| --- | --- | --- |
| Accounts | Upstream identity links, Better Auth sessions, permanent usernames, hosted handle claims, immutable DID reference, OAuth grant and replay state, authentication availability | Repositories, PDS hosting state, PLC documents, resource permissions |
| PDS | Local DID existence, provisioning and hosting state, repositories and keys, PDS sessions or app passwords, access-token signing, resource authorization | Upstream identity links, Better Auth sessions, hosted username allocation, OAuth consent |
| PLC Directory | DID operation log and resolved DID document | Login, username availability, handle reverse mapping |
| Handle Registry | Stateless HTTPS publication of the active hosted handle mapping supplied by Accounts | Registration policy, durable reservations, DID documents |
| Control Plane | Operator inventory, labels, desired lifecycle actions, and audit | Upstream identity data, Better Auth sessions, canonical identity data, OAuth consent, synchronous authorization decisions |

## Account state model

```text
NEEDS_USERNAME
  Better Auth session exists
  username = none, DID = none
        |
        | member confirms available username
        v
PROVISIONING
  username is reserved
  DID may be pending
  product and OAuth access are blocked
        |
        | local PDS account, PLC identity, repository,
        | and hosted handle verification are ready
        v
ACTIVE
  username is permanently committed
  one immutable DID exists
  hosted handle resolves bidirectionally
        |
        | lifecycle action
        v
DEACTIVATED
  username and DID remain reserved
  login, token issuance, and resource access are blocked
        |
        | deletion and retention policy
        v
TOMBSTONED
  upstream identity links and profile data are removed as required
  minimal username and DID reservation remains
```

State transitions must be monotonic around identity creation: after a DID exists, no transition can return the user to `NEEDS_USERNAME` or permit a different DID.

## Requirements

Requirements state required behavior. Delivery design remains a product, design, and engineering collaboration.

### Must-have

Requirements are ranked in release priority order.

1. **Common onboarding gate.** Every supported upstream identity provider must send a non-active user through the same account-completion policy before product or AT Protocol OAuth access.
2. **One confirmed username.** The member must be able to understand, choose, and confirm an available normalized username and its derived hosted handle.
3. **Permanent name safety.** After DID creation becomes irreversible, no failure, deactivation, or deletion may make the username available to another DID.
4. **Exactly-once identity outcome.** Repeated submissions, callback retries, timeouts, and service retries for one provisioning operation must produce no more than one DID and one permanent username claim.
5. **Recoverable setup.** A member must be able to see that provisioning is incomplete and resume it without choosing a new identity or contacting an operator for ordinary retryable failures.
6. **Single-subject OAuth.** An active member authorizes only their DID. A non-active member cannot receive a code or token, and consent submission must revalidate the current session and subject.
7. **Handle verification.** An active hosted handle must resolve to the same DID that claims it. A pending, inactive, or unknown hosted handle must not resolve.
8. **Lifecycle enforcement.** Deactivation must block new login sessions, new OAuth grants, token signing, and PDS resource use while preserving the username and DID identity record.
9. **Paired local deployment.** Upstream login, onboarding, consent, and token issuance must work with a configured local Accounts and PDS pair without a synchronous Control Plane dependency.
10. **No managed-account surface.** The user experience and service contracts must not expose owner, child, descendant, managed-DID CRUD, multi-DID selection, or external DID attachment concepts.

### High-want

These requirements are important but do not justify delaying the first safe local Entryway release.

1. **Authorization-flow continuation.** When protocol timing permits, onboarding entered from an OAuth request resumes the original authorization transaction automatically.
2. **Upstream profile assistance.** OIDC profile data may prefill a username suggestion without claiming it or weakening normal validation.
3. **Self-service status.** A member can distinguish waiting, retryable failure, and operator-required failure without seeing internal service details.

### Nice-to-have

1. Native registration with passwords or passkeys and the required verification and recovery flows.
2. Self-service custom handles, handle changes, aliases, or handle history.
3. Multiple local PDS resources behind one Accounts Entryway.
4. External DID migration or authorization-server delegation.
5. Rich Control Plane provisioning and lifecycle workflows built on the same Accounts-owned contract.

## Explicit non-goals for the first release

- Importing, attaching, claiming, or authorizing an existing external DID.
- Allowing one Better Auth user to control multiple DIDs.
- Sharing one DID across multiple Better Auth users.
- Making the Control Plane the registration orchestrator or a real-time authorization dependency.
- Native registration with passwords, passkeys, email verification, or credential recovery.
- Reusing deleted or retired usernames.
- Treating a social-provider display name as an approved username.
- Dynamic PDS selection or account migration between PDS instances.
- Replacing the dedicated AT Protocol OAuth profile with a generic OAuth provider plus PAR alone.
- Self-service handle changes, custom handles, or handle aliases.

## Trust and security boundaries

- Browser and form input is untrusted. It may request a username but cannot supply a DID, account state, issuer, audience, or authorization subject.
- Better Auth establishes the browser login principal. A valid browser session alone does not prove that AT Protocol onboarding is complete.
- Only the Accounts provisioning workflow may commit the user-to-DID reference and permanent username claim.
- Accounts decides which scopes the user consents to. The PDS constrains those scopes to capabilities it supports and is willing to enforce.
- The private PDS token operation must confirm the subject is a local, active DID and must stamp its configured issuer, audience, and lifetime.
- The Control Plane's operator authorization does not grant authority to impersonate an end user in OAuth.
- Username tombstones contain only the minimum data needed to prevent identity reassignment and satisfy audit or recovery policy.

## Migration

The existing owner-to-managed-DID model has no automatic credential-preserving migration:

- One owner credential cannot be copied to several DID users without recreating the relationship being removed.
- When several owners relate to one DID, the system cannot infer which credential should become authoritative.
- Managed DID rows may not have independently usable login credentials.

For production data, every DID requires an independent credential enrollment or recovery journey. OAuth must remain disabled for that identity until migration is complete.

For disposable development data, the preferred migration is a synchronized destructive rebuild of Accounts, PDS D1 and KV, repository Durable Objects, PLC Directory, Handle Registry-visible mappings, and Control Plane inventory. This is allowed only when no external party relies on an existing DID, handle, or repository.

## Product risks and discovery plan

SVPG recommends addressing value, usability, feasibility, and viability risks before treating a PRD as a build instruction.

### Assumptions to validate

- Minisphere controls the hosted handle domain and can publish its HTTPS handle verification responses.
- The first release can use one fixed Accounts and PDS pair and can reject external DID onboarding.
- Supported upstream identity providers return enough stable identity information for Better Auth account linking, but not a product-approved Minisphere username.
- Members will accept a required onboarding page after upstream authentication.
- The paired PDS can expose a durable pending state and idempotent provisioning contract around irreversible PLC creation.
- Existing data is disposable development data unless a migration inventory proves otherwise.

| Risk | Current assumption | Evidence needed before release |
| --- | --- | --- |
| Value | Members accept one required username step in exchange for a hosted AT identity | Observe completion and abandonment after upstream login; establish a conversion baseline and target |
| Usability | Members understand the difference between upstream login identity, username, hosted handle, and DID when shown only the necessary concepts | Test the upstream callback, username, conflict, retry, and returning-login prototypes with representative members |
| Feasibility | One provisioning operation can safely span Accounts, PDS, PLC, repository creation, and handle publication | Demonstrate duplicate submissions, timeouts at each boundary, restart, and forward recovery without duplicate DIDs |
| Viability | Permanent username retention, deletion tombstones, and hosted-handle policy are acceptable for operations, privacy, and abuse prevention | Review retention policy, namespace abuse controls, support workflow, and applicable privacy obligations |

### Discovery activities

1. Prototype the upstream-provider callback and required username onboarding path before final interaction design.
2. Test whether users understand the generated hosted handle and permanent username commitment.
3. Test username conflict and provisioning-retry messages; users should know what action is safe.
4. Exercise the provisioning state model against failures before and after irreversible PLC creation.
5. Establish baseline onboarding completion time, abandonment, handle-conflict rate, and retry rate.
6. Validate the deactivation and deletion policy with product, security, operations, and privacy stakeholders.

## Release criteria

### Functional

- Every must-have requirement has an acceptance scenario covering each supported upstream identity provider where applicable.
- One active user resolves to one DID; a non-active user resolves to no OAuth subject.
- No owner relationship, managed-account API, or DID chooser remains in the supported product flow.
- Hosted handle resolution and the DID document agree before activation.

### Reliability

- Duplicate username submissions and provisioning retries produce at most one DID.
- A failure injected at every cross-service boundary has a documented retry outcome.
- No failure after DID creation permits username release, DID replacement, or return to pre-onboarding state.
- Deactivation consistently blocks Accounts authorization and PDS token issuance.

### Security and protocol

- OAuth consent binds the authenticated internal user to one server-resolved DID and rechecks it on submission.
- The PDS token signer rejects non-local, inactive, or unsupported-scope requests.
- Existing PAR, PKCE, DPoP, replay, refresh rotation, and revocation tests continue to pass under the single-subject model.
- Production remains blocked until the PDS resource-server criteria below pass.

### Usability

- A member from each supported upstream identity provider can reach an active account without operator assistance under normal conditions.
- A member encounters no DID selector and is never asked to type or paste a DID.
- A member can distinguish username conflict from provisioning delay or failure.
- Prototype testing validates the onboarding copy and interaction before release scope is committed.

### Performance and scalability

- Product discovery must establish and approve numeric onboarding and handle-resolution latency targets before production release.
- Concurrent claims for one normalized username have one winner.
- Capacity testing must cover the approved registration target and duplicate-request rate without weakening uniqueness or retry guarantees.

### Supportability

- Support can identify a user's current onboarding state without access to credentials or tokens.
- Support can distinguish a safe pre-DID cancellation from a post-DID operation that requires forward recovery.
- A normal retryable failure does not require direct database edits.

### Localizability

- The first release may ship in English, but user-facing onboarding states and errors must not rely on protocol error strings as product copy.
- Username normalization and handle syntax are locale-independent and produce the same result in every client.

## Separate production gate: PDS OAuth resource server

The identity-model refactor is necessary but not sufficient for production OAuth. Production use remains blocked until the PDS:

1. accepts and fully validates Accounts-issued OAuth access tokens on protected XRPC routes;
2. validates resource-request DPoP, including `ath`, key binding, freshness, and replay;
3. enforces AT Protocol repository permissions with `@atproto/oauth-scopes`; and
4. checks local account active state when serving protected requests.

These requirements should be delivered and reviewed independently of the Entryway identity refactor so that identity ownership changes are not confused with resource-server security.

## Schedule and sequence

No delivery date has been approved. The target sequence is:

1. Resolve the open product decisions and validate the onboarding interaction.
2. Deliver the single-user, single-DID Entryway model with the local hosted-handle flow.
3. Validate destructive development migration or approve a production credential migration plan.
4. Deliver the separate PDS OAuth resource-server production gate.
5. Consider custom handles, multiple PDS instances, and external DID trust as later discovery work.

A date should be attached only after discovery resolves the significant usability and provisioning-recovery risks.

## Open product decisions

1. How long does a pre-DID username reservation remain valid when onboarding is abandoned?
2. Which upstream identity providers are supported in the first release?
3. Which upstream identity-provider account-linking rules prevent duplicate Better Auth users for one person?
4. Does first-delivery OAuth onboarding resume a valid authorization transaction automatically, or ask every client to restart?
5. What retention period and operator access apply to username/DID tombstones?
6. What recovery proof is required when a member loses access to their upstream identity?
7. Which numeric onboarding conversion, latency, and capacity targets define production readiness?

## References

- Martin Cagan, [How To Write a Good PRD](https://www.svpg.com/wp-content/uploads/2024/07/How-To-Write-a-Good-PRD.pdf)
- Marty Cagan, [Discovery vs. Documentation](https://www.svpg.com/discovery-vs-documentation/)
- SVPG, [Product Risk Taxonomy](https://www.svpg.com/product-risk-taxonomies)
- [Accounts architecture](../../apps/accounts/README.md)
- [PDS architecture and OAuth resource contract](../../apps/pds/README.md)
- [Handle Registry trust boundary](../../apps/handle-registry/README.md)
- [Current development decisions](../../DEVELOPMENT.md)
