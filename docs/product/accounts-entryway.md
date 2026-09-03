# Accounts Entryway Account Model — Product Requirements

- **Status:** Draft for product discovery
- **Scope:** OIDC login, username onboarding, local DID account provisioning, hosted handle registration, and OAuth subject selection
- **Baseline:** `feat/accounts-entryway-account-model`
- **Last updated:** 2026-09-03

This is a living product document. It records the target, settled product decisions, unresolved risks, and release criteria. It does not replace product discovery, interaction prototypes, or technical design.

## Product purpose

Minisphere needs an Accounts service that behaves like an AT Protocol Entryway. In the first release, a person authenticates through one configured OIDC provider. After authentication, the person chooses one local username and creates one DID account on the paired PDS. Successful account creation commits the username, its hosted handle, and the DID as one product outcome.

The resulting Accounts and PDS pair should preserve a path toward participation in the wider AT Protocol network.

The first release deliberately excludes local registration, passwords, passkeys, and their verification and recovery flows. Those capabilities require separate discovery and must not complicate the initial Entryway onboarding path.

### Problems to solve

The current account model has four product problems:

1. A Better Auth owner can manage multiple related DID users. This is a Minisphere management policy, not a generic Entryway account model.
2. PDS account creation requires a handle, but upstream OIDC and social-login callbacks do not give a new user an opportunity to choose a valid, unique local username.
3. The current flow derives a synthetic email and a managed handle from the same username, which conflates login identity, account name, and AT Protocol identity.
4. Account creation spans Accounts, the PDS, the PLC Directory, the repository store, and handle verification. A partial failure can leave an identity that cannot safely be recreated or completed.

### Value proposition

A new member can sign in through the configured OIDC provider, complete one clear username step, and receive one working AT Protocol identity. The member does not need to understand owner relationships, DID selection, or PDS placement.

### Release objectives

Objectives are listed in priority order.

1. **One understandable account:** every AT-active Accounts user represents exactly one DID account, with no owner-to-managed-user concept.
2. **Simple OIDC onboarding:** the configured OIDC provider returns a new member to one required username and DID creation flow.
3. **Stable identity:** a DID never changes and a committed username is never reused.
4. **Atomic product outcome:** a successful attempt commits one username and one active DID; a confirmed failure does not retain the username; an unknown outcome is checked and retried against the same pre-derived DID.
5. **Protocol-safe authorization:** a user without an active DID cannot authorize an AT Protocol OAuth client.
6. **Portable product boundary:** the local Accounts and PDS pair supports onboarding, login, consent, and token issuance as one complete product boundary.

The first release is successful when all must-have scenarios and release criteria in this document pass. Conversion and latency targets require a measured baseline during discovery; they must be set before production release rather than invented in this document.

## Target users and scenarios

### Primary user profiles

#### OIDC member

This member signs in with the deployment's configured OIDC provider. The provider authenticates the member but does not select a Minisphere username. The member expects to complete setup after the provider callback without creating another login.

#### Returning AT Protocol member

This member has completed provisioning. They expect normal login to restore access to the same DID and expect OAuth authorization to show that identity without asking them to choose among DIDs.

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
3. A confirmed PDS response failure does not commit the username, handle, or DID account in Accounts. Downstream dangling artifacts are acceptable and remain inactive in Accounts.
4. A transport failure has an unknown outcome. Accounts retains the expected DID, checks PDS repository and PLC state, and only then retries the same standard account-creation request if needed.
5. An unknown-outcome retry uses the same DID and signed genesis PLC operation.

## Product principles

1. **Authenticate first, onboard once.** The configured OIDC provider leads to one post-authentication account-completion flow.
2. **One principal, one identity.** A user may have no DID while onboarding and exactly one DID after activation. Accounts has no user-to-user ownership model.
3. **Username and DID are permanent.** A committed username and DID are never reassigned. The username produces the initial hosted handle.
4. **The user chooses names, not identifiers.** The member chooses a username. Accounts derives the DID from a server-signed genesis PLC operation; the browser never supplies or selects one.
5. **Fail closed and verify unknown outcomes.** Incomplete accounts cannot authorize clients. After a transport failure, Accounts checks the known DID in the PDS and PLC Directory before it retries creation.
6. **One source of truth per responsibility.** Accounts owns authentication and hosted handle claims. The PDS owns local account state and repository hosting. The PLC Directory owns DID documents.
7. **Accounts owns provisioning.** User-facing identity and authorization use the Accounts-owned account state and provisioning workflow.
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
- Accounts signs the access token as the authorization server. The PDS verifies that signature and independently confirms that the DID is local and active when serving a protected request.

### Provisioning ownership

Accounts owns the member-facing provisioning journey because it owns the Better Auth session, OIDC identity link, username, onboarding state, and PLC rotation key. The PDS owns account invitations, the repository private signing key, and local account and repository state. The PDS submits the genesis operation to the PLC Directory.

Provisioning follows the AT Protocol reference Entryway flow. Accounts first calls `com.atproto.server.reserveSigningKey`; the PDS stores the private repository key and returns the public `did:key`. Accounts then constructs and signs the genesis PLC operation, derives the DID, obtains a one-time PDS invitation through its trusted service binding, and calls standard `com.atproto.server.createAccount` with the invite, DID, and operation. The invitation authorizes account creation. The PDS trusts the Accounts-supplied identity material, creates the repository and local account, and registers the operation with PLC. Accounts verifies the resulting PDS and PLC state before activation.

Accounts activates only after the PDS reports that both the local account and repository exist and PLC resolves the expected DID, handle claim, PDS endpoint, and repository signing key. Handle Registry publication is controlled by the resulting active Accounts mapping, so querying that derived publication is not an activation prerequisite.

A confirmed PDS response failure releases the provisional Accounts username. A transport failure remains unknown and retains the expected DID and signed operation for status checks and retry. This guarantees one active identity result for the attempt without a custom PDS provisioning service or operation ID. The PDS must not receive OIDC credentials or Better Auth session material, or write Better Auth storage directly.

### Target flow

```text
OIDC provider ──> Better Auth session ──> username onboarding
  discovery URL                             |
  from environment                          | confirmed username
                                            v
                                     Accounts Entryway
                               |            |             |
                               | reserve    | derive DID  | verify PLC state
                               | repo key   | + genesis   |
                               v            v             v
                         paired local PDS ───────────▶ PLC Directory
                               |      |
                               |      └────────────────▶ repository
                               |
                               | standard createAccount
                               | plus PDS/repo verification
                               v
                     verified active identity result
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
                                                   Accounts OAuth signer
                                                             |
                                                             v
                                                    PDS resource verifier
```

### Service ownership

| Service | Owns | Does not own |
| --- | --- | --- |
| Accounts | OIDC identity links, Better Auth sessions, permanent usernames, hosted handle claims, PLC rotation key, immutable DID reference, OAuth grant and replay state, OAuth access-token signing, authentication availability | Repository private keys, PDS hosting state, PLC documents, resource permissions |
| PDS | Local DID existence, provisioning and hosting state, repositories and private signing keys, PLC submission, PDS sessions or app passwords, OAuth access-token verification, resource authorization | OIDC identity links, Better Auth sessions, hosted username allocation or uniqueness, OAuth consent or access-token signing |
| PLC Directory | DID operation log and resolved DID document | Login, username availability, handle reverse mapping |
| Handle Registry | Stateless HTTPS publication of the active hosted handle mapping supplied by Accounts | Username allocation, account creation, DID documents |

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
        | local PDS account and repository exist,
        | and PLC resolves the expected account state
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
4. **Single active identity outcome.** Repeated submissions and unknown-outcome retries for one attempt must activate no more than one DID and one permanent username claim. Dangling downstream artifacts from a confirmed failure are not active Accounts identities.
5. **Safe unknown-outcome retry.** A member must be able to retry a transport failure against the same pre-derived DID and signed PLC operation.
6. **Single-subject OAuth.** An active member authorizes only their DID. A non-active member cannot receive a code or token, and consent submission must revalidate the current session and subject.
7. **Handle publication.** An active hosted handle must resolve to the same DID that claims it. A failed, incomplete, or unknown hosted handle must not resolve. Because Accounts owns both activation and the hosted mapping, Handle Registry is derived output rather than an activation gate.
8. **Paired local deployment.** OIDC login, onboarding, consent, and token issuance must work with a configured local Accounts and PDS pair.
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

## Explicit non-goals for the first release

- Importing, attaching, claiming, or authorizing an existing external DID.
- Allowing one Better Auth user to control multiple DIDs.
- Sharing one DID across multiple Better Auth users.
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
- Accounts must stamp the configured issuer, PDS audience, and maximum lifetime, sign with its dedicated OAuth key, and publish the corresponding public JWKS. The PDS must discover that key from the configured Accounts issuer and confirm that the subject is a local, active DID on protected requests.

## Migration

The first release assumes disposable development data. Migration uses a synchronized destructive rebuild of Accounts and PDS D1, repository Durable Objects, PLC Directory, and Handle Registry-visible mappings. Migrating production owner-to-managed-DID data is out of scope.

## Product risks and discovery plan

SVPG recommends addressing value, usability, feasibility, and viability risks before treating a PRD as a build instruction.

### Assumptions to validate

- Minisphere controls the hosted handle domain and can publish its HTTPS handle verification responses.
- The first release can use one fixed Accounts and PDS pair and can reject external DID onboarding.
- One OIDC provider supplies a stable issuer and subject through metadata discovered from a deployment-configured URL.
- Members will accept a required onboarding page after OIDC login.
- The paired PDS supports standard signing-key reservation, externally supplied DID and PLC operation account creation, and repository status checks.
- Existing data is disposable development data.

| Risk | Current assumption | Evidence needed before release |
| --- | --- | --- |
| Value | Members accept one required username step in exchange for a hosted AT identity | Observe completion and abandonment after OIDC login; establish a conversion baseline and target |
| Usability | Members understand the difference between OIDC login, username, hosted handle, and DID when shown only the necessary concepts | Test the OIDC callback, username, conflict, retry, and returning-login prototypes with representative members |
| Feasibility | One provisioning attempt can safely span Accounts, PDS, PLC, repository creation, and handle publication | Demonstrate duplicate submissions, transport failures at each boundary, restart, and forward recovery with one active Accounts identity result |
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
- A transport failure retains the same expected DID, verifies PDS and PLC state, and retries the same signed operation only when needed.
- An incomplete account cannot resolve a hosted handle or OAuth subject.

### Security and protocol

- OAuth consent binds the authenticated internal user to one server-resolved DID and rechecks it on submission.
- Accounts rejects invalid token issuance inputs. PDS token verification rejects an invalid signature, issuer, audience, lifetime, or scope.
- Existing PAR, PKCE, DPoP, replay, refresh rotation, and revocation tests continue to pass under the single-subject model.
- Production remains blocked until the PDS resource-server criteria below pass.

### Usability

- A member from the configured OIDC provider can reach an active account without manual assistance under normal conditions.
- A member encounters no DID selector and is never asked to type or paste a DID.
- A member can distinguish username conflict from provisioning delay or failure.
- Prototype testing validates the onboarding copy and interaction before release scope is committed.

### Performance and scalability

- Product discovery must establish and approve numeric onboarding and handle-resolution latency targets before production release.
- Concurrent claims for one normalized username have one winner.
- Capacity testing must cover the approved registration target and duplicate-request rate without weakening uniqueness or retry guarantees.

### Supportability

- Accounts can distinguish an unknown transport outcome from a confirmed PDS response failure without access to OIDC credentials or tokens.
- A normal retry does not require direct database edits.

### Localizability

- The first release may ship in English, but user-facing onboarding states and errors must not rely on protocol error strings as product copy.
- Username normalization and handle syntax are locale-independent and produce the same result in every client.

## Account-management implementation TODO

These follow-ups come from comparing the current Accounts and PDS implementation with the AT Protocol reference implementation. The design direction for each item is settled below. A per-user provisioning single-flight or lease is not included because the expected request pattern does not justify that complexity.

- [x] **Store PDS account invitations in D1.** Store each bearer code in plaintext with its expiry, but do not bind the code to a DID. Validate the account material first, then atomically consume one unexpired code before account-creation side effects. A consumed code remains spent after a downstream failure; Accounts obtains a new code for a retry. Expired unused rows can be removed opportunistically. Verify that only one of two concurrent requests using the same code can begin provisioning and that a completed account never leaves a reusable invitation.
- [x] **Make initial RepoDO creation atomic and recoverable.** Format and sign the initial commit before entering the Durable Object SQLite transaction. Inside one synchronous transaction, store the signing key, all initial blocks, and metadata containing the final root CID and revision; never persist empty root metadata as an initialization marker. Load the repository only after the transaction commits. Use the same atomic blocks-and-root boundary for later commits. A same-DID, same-key retry verifies the readable repository, a different key is rejected, and an incomplete repository from the former initialization sequence is rebuilt atomically.
- [x] **Store repository signing-key reservations in PDS D1.** Store the private key encrypted under a stable deployment secret and keep durable reservation state without the independent two-hour KV expiry. Identify a new reservation by its public signing key, then atomically claim it for the derived DID during account creation; another DID cannot claim the same key. Keep the reservation until RepoDO is readable and PLC submission succeeds, then delete it in the same D1 batch that records the PDS account and refresh token. Do not expire reservations in the provisioning path; any future cleanup of abandoned, unclaimed reservations requires a separate policy. A delayed same-DID retry uses the same private key.
- [ ] **Define and enforce a hosted-username reservation policy.** Maintain one categorized Minisphere-specific `ReadonlySet<string>` and exact-match helper after username normalization; do not copy another product's list unchanged. Include relevant authentication and operator names, AT Protocol terms, service and API routes, privileged mailbox names, infrastructure hostnames, and names that must remain reserved after a route is removed. Validate `PUBLIC_HANDLE_DOMAIN` as a canonical handle suffix. Apply the same shared policy to UI validation, availability checks, and atomic account reservation, while keeping the server authoritative. Use Multica's categorized [reserved slug table](https://github.com/multica-ai/multica/blob/a075e58b80895f14cacfe3a9aa0808e1cde1f69a/packages/core/paths/reserved-slugs.ts#L41) as one design reference.

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
