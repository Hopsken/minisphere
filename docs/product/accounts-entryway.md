# Accounts Entryway Account Model — Product Requirements

- **Status:** Draft for product discovery
- **Scope:** OIDC login, username onboarding, local DID account provisioning, hosted handle registration, and OAuth subject selection
- **Baseline:** `feat/accounts-pds-oauth-integration`
- **Last updated:** 2026-09-01

This is a living product document. It records the target, settled product decisions, unresolved risks, and release criteria. It does not replace product discovery, interaction prototypes, or technical design.

## Product purpose

Minisphere needs an Accounts service that behaves like an AT Protocol Entryway rather than a control plane for owner-managed identities. In the first release, a person authenticates through one configured OIDC provider. After authentication, the person chooses one local username and creates one DID account on the paired PDS. Successful account creation commits the username, its hosted handle, and the DID as one product outcome.

The resulting Accounts and PDS pair should be usable independently of Minisphere's Control Plane and should preserve a path toward participation in the wider AT Protocol network.

The first release deliberately excludes local registration, passwords, passkeys, and their verification and recovery flows. Those capabilities require separate discovery and must not complicate the initial Entryway onboarding path.

### Problems to solve

The current account model has four product problems:

1. A Better Auth owner can manage multiple related DID users. This is a Minisphere management policy, not a generic Entryway account model.
2. PDS account creation requires a handle, but upstream OIDC and social-login callbacks do not give a new user an opportunity to choose a valid, unique local username.
3. The current flow derives a synthetic email and a managed handle from the same username, which conflates login identity, account name, and AT Protocol identity.
4. Account creation spans Accounts, the PDS, the PLC Directory, the repository store, and handle verification. A partial failure can leave an identity that cannot safely be recreated or completed.

### Value proposition

A new member can sign in through the configured OIDC provider, complete one clear username step, and receive one working AT Protocol identity. The member does not need to understand owner relationships, DID selection, PDS placement, or Control Plane concepts.

### Release objectives

Objectives are listed in priority order.

1. **One understandable account:** every AT-active Accounts user represents exactly one DID account, with no owner-to-managed-user concept.
2. **Simple OIDC onboarding:** the configured OIDC provider returns a new member to one required username and DID creation flow.
3. **Stable identity:** a DID never changes and a committed username is never reused.
4. **Atomic product outcome:** a successful operation commits one username and one DID; a failed operation does not take the username; retries cannot create a second DID.
5. **Protocol-safe authorization:** a user without an active DID cannot authorize an AT Protocol OAuth client.
6. **Portable product boundary:** the local Accounts and PDS pair does not depend on the Control Plane during onboarding, login, consent, or token issuance.

The first release is successful when all must-have scenarios and release criteria in this document pass. Conversion and latency targets require a measured baseline during discovery; they must be set before production release rather than invented in this document.

## Target users and scenarios

### Primary user profiles

#### OIDC member

This member signs in with the deployment's configured OIDC provider. The provider authenticates the member but does not select a Minisphere username. The member expects to complete setup after the provider callback without creating another login.

#### Returning AT Protocol member

This member has completed provisioning. They expect normal login to restore access to the same DID and expect OAuth authorization to show that identity without asking them to choose among DIDs.

#### Operator

An operator needs to observe provisioning state and request lifecycle actions. The operator does not choose a user's DID, handle consent, or participate in the real-time OAuth path.

### Core scenarios

#### OIDC onboarding

1. The configured OIDC provider returns an authenticated member to Accounts.
2. Accounts creates or restores a Better Auth session.
3. A member without an active DID is sent to the required username page.
4. The member selects an available username and confirms the hosted handle.
5. Accounts attempts one username and DID account creation operation.
6. Success activates the username, hosted handle, and DID together. Confirmed failure leaves the username available.

Accounts may suggest a username from upstream profile data, but it must not claim that username without member confirmation.

#### OAuth request before onboarding is complete

1. An AT Protocol client starts authorization.
2. Accounts authenticates the member.
3. If the member needs a username or is still provisioning, Accounts sends the member through onboarding before consent.
4. After onboarding, the first release asks the client to restart authorization rather than preserving a long-lived authorization transaction across account creation.
5. Accounts never creates a code or token without one active DID subject.

#### Returning OAuth authorization

1. Accounts authenticates the member.
2. The consent page displays the single DID, hosted handle, client, and requested scopes.
3. Accounts rechecks the same session and subject when the member submits consent.
4. The member never sees a DID chooser and never submits a DID as form input.

#### Provisioning interruption

1. The member submits an available username.
2. A downstream operation times out or fails.
3. A confirmed failure does not commit the username, handle, or DID account.
4. A timeout has an unknown outcome and is retried with the same operation identity until Accounts can determine success or failure.
5. A retry cannot create a second DID for the same operation.

## Product principles

1. **Authenticate first, onboard once.** The configured OIDC provider leads to one post-authentication account-completion flow.
2. **One principal, one identity.** A user may have no DID while onboarding and exactly one DID after activation. Accounts has no user-to-user ownership model.
3. **Username and DID are permanent.** A committed username and DID are never reassigned. The username produces the initial hosted handle.
4. **The user chooses names, not identifiers.** The member chooses a username. The PDS creates the DID; the browser never supplies or selects one.
5. **Fail closed and retry unknown outcomes.** Incomplete accounts cannot authorize clients. A timeout is not reported as failure until the same idempotent operation resolves.
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

### Upstream authentication

- The first release supports one generic OIDC provider.
- The deployment environment supplies its OIDC discovery URL and client configuration.
- Accounts uses OIDC discovery rather than provider-specific integration code.
- The OIDC issuer and subject identify the upstream login. Multiple providers and cross-provider account linking are out of scope.

### Username and handle

- The member selects one normalized username.
- The initial hosted handle is derived as `<username>.<PUBLIC_HANDLE_DOMAIN>`.
- Upstream login identities, display names, usernames, and hosted handles are distinct concepts.
- Username registration and local DID account creation are one product-level operation.
- A confirmed provisioning failure leaves the username available.
- A successful operation commits the username permanently to its DID. Later lifecycle events do not make it reusable.
- Custom handles and handle changes require separate future discovery. The first release defines only the initial hosted handle.

### Authorization subject

- Accounts resolves at most one DID subject from the authenticated Better Auth user.
- A missing or inactive subject blocks authorization.
- Consent records the internal user and resolved DID server-side.
- Consent submission verifies the same browser session, resolves the subject again, and requires the DID to match the stored transaction.
- The PDS independently confirms that the DID is local and active before signing an access token.

### Provisioning ownership

Accounts owns the member-facing provisioning journey because it owns the Better Auth session, OIDC identity link, and onboarding state. It coordinates a private, idempotent PDS operation. The PDS creates the DID, PLC operation, repository, and local hosting state.

The operation has two final outcomes: all identity fields become active, or none is committed in Accounts. A timeout is an unknown outcome, not a final failure; Accounts retries the same operation identity before making the username available. The PDS and Control Plane must not receive OIDC credentials or Better Auth session material, or write Better Auth storage directly.

### Target flow

```text
OIDC provider ──> Better Auth session ──> username onboarding
  discovery URL                             |
  from environment                          | confirmed username
                                            v
                                     Accounts Entryway
                                            |
                                            | one private, idempotent
                                            | account creation operation
                                            v
                       PLC Directory <── paired local PDS ──> repository
                                            |
                                            | success commits username,
                                            | hosted handle, and DID
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
| Accounts | OIDC identity links, Better Auth sessions, permanent usernames, hosted handle claims, immutable DID reference, OAuth grant and replay state, authentication availability | Repositories, PDS hosting state, PLC documents, resource permissions |
| PDS | Local DID existence, provisioning and hosting state, repositories and keys, PDS sessions or app passwords, access-token signing, resource authorization | OIDC identity links, Better Auth sessions, hosted username allocation, OAuth consent |
| PLC Directory | DID operation log and resolved DID document | Login, username availability, handle reverse mapping |
| Handle Registry | Stateless HTTPS publication of the active hosted handle mapping supplied by Accounts | Username allocation, account creation, DID documents |
| Control Plane | Operator inventory, labels, desired lifecycle actions, and audit | OIDC identity data, Better Auth sessions, canonical identity data, OAuth consent, synchronous authorization decisions |

## Account state model

```text
NEEDS_USERNAME
  Better Auth session exists
  username = none, DID = none
        |
        | member confirms available username
        v
PROVISIONING
  username is not yet committed
  account creation outcome may be unknown
  product and OAuth access are blocked
        |
        | confirmed failure
        +--------------------------> NEEDS_USERNAME
        |
        | local PDS account, PLC identity, repository,
        | and hosted handle verification are ready
        v
ACTIVE
  username is permanently committed
  one immutable DID exists
  hosted handle resolves bidirectionally
```

Only `ACTIVE` commits the username and DID in Accounts. A confirmed failure returns to `NEEDS_USERNAME` without taking the username. After activation, no transition can assign a different DID or make the username reusable.

## Requirements

Requirements state required behavior. Delivery design remains a product, design, and engineering collaboration.

### Must-have

Requirements are ranked in release priority order.

1. **Common onboarding gate.** The configured OIDC provider must send a non-active user through account completion before product or AT Protocol OAuth access.
2. **One confirmed username.** The member must be able to understand, choose, and confirm an available normalized username and its derived hosted handle.
3. **Atomic activation.** Success commits the username, hosted handle, and DID together. Confirmed failure commits none of them and leaves the username available.
4. **Exactly-once identity outcome.** Repeated submissions, callback retries, timeouts, and service retries for one operation must produce no more than one DID and one permanent username claim.
5. **Safe retry.** A member must be able to retry an unknown or failed operation without creating a second DID.
6. **Single-subject OAuth.** An active member authorizes only their DID. A non-active member cannot receive a code or token, and consent submission must revalidate the current session and subject.
7. **Handle verification.** An active hosted handle must resolve to the same DID that claims it. A failed, incomplete, or unknown hosted handle must not resolve.
8. **Paired local deployment.** OIDC login, onboarding, consent, and token issuance must work with a configured local Accounts and PDS pair without a synchronous Control Plane dependency.
9. **No managed-account surface.** The user experience and service contracts must not expose owner, child, descendant, managed-DID CRUD, multi-DID selection, or external DID attachment concepts.

### High-want

These requirements are important but do not justify delaying the first safe local Entryway release.

1. **OIDC profile assistance.** OIDC profile data may prefill a username suggestion without claiming it or weakening normal validation.
2. **Self-service status.** A member can distinguish waiting from confirmed failure without seeing internal service details.

### Nice-to-have

1. Native registration with passwords or passkeys and the required verification and recovery flows.
2. Self-service custom handles, handle changes, aliases, or handle history.
3. Multiple upstream identity providers and cross-provider account linking.
4. Multiple local PDS resources behind one Accounts Entryway.
5. External DID migration or authorization-server delegation.
6. Rich Control Plane provisioning and lifecycle workflows built on the same Accounts-owned contract.

## Explicit non-goals for the first release

- Importing, attaching, claiming, or authorizing an existing external DID.
- Allowing one Better Auth user to control multiple DIDs.
- Sharing one DID across multiple Better Auth users.
- Making the Control Plane the registration orchestrator or a real-time authorization dependency.
- Native registration with passwords, passkeys, email verification, or credential recovery.
- Multiple upstream identity providers or cross-provider account linking.
- Account recovery, self-service deactivation, and self-service deletion.
- Reusing deleted or retired usernames.
- Treating a social-provider display name as an approved username.
- Dynamic PDS selection or account migration between PDS instances.
- Replacing the dedicated AT Protocol OAuth profile with a generic OAuth provider plus PAR alone.
- Self-service handle changes, custom handles, or handle aliases.

## Trust and security boundaries

- Browser and form input is untrusted. It may request a username but cannot supply a DID, account state, issuer, audience, or authorization subject.
- Better Auth accepts login identity only from the OIDC issuer discovered through deployment configuration. A valid browser session alone does not prove that AT Protocol onboarding is complete.
- Only a successful Accounts provisioning operation may commit the user-to-DID reference and permanent username claim.
- Accounts decides which scopes the user consents to. The PDS constrains those scopes to capabilities it supports and is willing to enforce.
- The private PDS token operation must confirm the subject is a local, active DID and must stamp its configured issuer, audience, and lifetime.
- The Control Plane's operator authorization does not grant authority to impersonate an end user in OAuth.

## Migration

The first release assumes disposable development data. Migration uses a synchronized destructive rebuild of Accounts, PDS D1 and KV, repository Durable Objects, PLC Directory, Handle Registry-visible mappings, and Control Plane inventory. Migrating production owner-to-managed-DID data is out of scope.

## Product risks and discovery plan

SVPG recommends addressing value, usability, feasibility, and viability risks before treating a PRD as a build instruction.

### Assumptions to validate

- Minisphere controls the hosted handle domain and can publish its HTTPS handle verification responses.
- The first release can use one fixed Accounts and PDS pair and can reject external DID onboarding.
- One OIDC provider supplies a stable issuer and subject through metadata discovered from a deployment-configured URL.
- Members will accept a required onboarding page after OIDC login.
- The paired PDS supports an idempotent account creation operation whose unknown outcome can be retried.
- Existing data is disposable development data.

| Risk | Current assumption | Evidence needed before release |
| --- | --- | --- |
| Value | Members accept one required username step in exchange for a hosted AT identity | Observe completion and abandonment after OIDC login; establish a conversion baseline and target |
| Usability | Members understand the difference between OIDC login, username, hosted handle, and DID when shown only the necessary concepts | Test the OIDC callback, username, conflict, retry, and returning-login prototypes with representative members |
| Feasibility | One provisioning operation can safely span Accounts, PDS, PLC, repository creation, and handle publication | Demonstrate duplicate submissions, timeouts at each boundary, restart, and forward recovery without duplicate DIDs |
| Viability | A deployment-configured OIDC provider and permanent username policy are sufficient for the initial network | Verify OIDC discovery interoperability and basic username abuse controls |

### Discovery activities

1. Prototype the OIDC callback and required username onboarding path before final interaction design.
2. Test whether users understand the generated hosted handle and permanent username commitment.
3. Test username conflict and provisioning-retry messages; users should know what action is safe.
4. Exercise the provisioning state model against failures before and after irreversible PLC creation.
5. Establish baseline onboarding completion time, abandonment, handle-conflict rate, and retry rate.

## Release criteria

### Functional

- Every must-have requirement has an acceptance scenario covering the configured OIDC provider where applicable.
- One active user resolves to one DID; a non-active user resolves to no OAuth subject.
- No owner relationship, managed-account API, or DID chooser remains in the supported product flow.
- Hosted handle resolution and the DID document agree before activation.

### Reliability

- Duplicate username submissions and retries produce at most one successful username and DID pair.
- A confirmed account creation failure leaves the username available.
- A timeout retries the same operation identity and cannot produce a second DID.
- An incomplete account cannot resolve a hosted handle or OAuth subject.

### Security and protocol

- OAuth consent binds the authenticated internal user to one server-resolved DID and rechecks it on submission.
- The PDS token signer rejects non-local, inactive, or unsupported-scope requests.
- Existing PAR, PKCE, DPoP, replay, refresh rotation, and revocation tests continue to pass under the single-subject model.
- Production remains blocked until the PDS resource-server criteria below pass.

### Usability

- A member from the configured OIDC provider can reach an active account without operator assistance under normal conditions.
- A member encounters no DID selector and is never asked to type or paste a DID.
- A member can distinguish username conflict from provisioning delay or failure.
- Prototype testing validates the onboarding copy and interaction before release scope is committed.

### Performance and scalability

- Product discovery must establish and approve numeric onboarding and handle-resolution latency targets before production release.
- Concurrent claims for one normalized username have one winner.
- Capacity testing must cover the approved registration target and duplicate-request rate without weakening uniqueness or retry guarantees.

### Supportability

- Accounts can distinguish an unknown operation from a confirmed failure without access to OIDC credentials or tokens.
- A normal retry does not require direct database edits.

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
3. Rebuild disposable development identity data for the new model.
4. Deliver the separate PDS OAuth resource-server production gate.
5. Consider custom handles, multiple PDS instances, and external DID trust as later discovery work.

A date should be attached only after discovery resolves the significant usability and provisioning-recovery risks.

## Open product decisions

1. Which numeric onboarding conversion, latency, and capacity targets define production readiness?

## References

- Martin Cagan, [How To Write a Good PRD](https://www.svpg.com/wp-content/uploads/2024/07/How-To-Write-a-Good-PRD.pdf)
- Marty Cagan, [Discovery vs. Documentation](https://www.svpg.com/discovery-vs-documentation/)
- SVPG, [Product Risk Taxonomy](https://www.svpg.com/product-risk-taxonomies)
- [Accounts architecture](../../apps/accounts/README.md)
- [PDS architecture and OAuth resource contract](../../apps/pds/README.md)
- [Handle Registry trust boundary](../../apps/handle-registry/README.md)
- [Current development decisions](../../DEVELOPMENT.md)
