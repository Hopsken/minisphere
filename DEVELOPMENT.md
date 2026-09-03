# Development Notes

This file records the current implementation state and important architecture decisions. Keep entries concise and update them when a decision changes.

## Current state — 2026-09-02

### Accounts

- The Accounts app is the account and primary authentication authority on a Hono Worker, Better Auth, and D1.
- Its frontend environment matches the Control Plane stack: Vite, TanStack Router, TanStack Query, Tailwind CSS, and Base UI shadcn conventions.
- It authenticates users through one deployment-configured generic OIDC provider. Local registration and primary passwords are disabled.
- Each Better Auth user has zero or one `atproto_account`. That record reserves one permanent normalized username and becomes active with one immutable DID. Hosted handles are derived from usernames and `PUBLIC_HANDLE_DOMAIN`.
- Account completion uses `needs_username`, `provisioning`, and `active` states. A transport failure keeps the pre-derived DID and signed PLC operation for status checks and retry. A confirmed PDS response failure releases the provisional username claim.
- Accounts gets one-time account invites from `PdsControlPlane.generateInviteCode()` and provisions through standard `com.atproto.server.reserveSigningKey` and `com.atproto.server.createAccount` XRPC methods exposed by `PdsControlPlane.fetch()`. It exposes active-only handle resolution through `AccountsEntrypoint`.
- Accounts owns the PLC rotation private key. It derives the DID from the genesis operation before PDS account creation and activates only after PDS account and repository state and resolved PLC state match the expected identity.
- Accounts provides the public-client AT Protocol OAuth authorization-code flow through a dedicated Better Auth plugin. App passwords are not implemented.
- OAuth protocol and replay state uses database-backed Better Auth verification records. Consent binds one server-resolved active DID to the current user. A React route renders server-validated consent details; the browser does not select or submit a DID.
- Accounts signs DPoP-bound OAuth access JWTs with a dedicated private key and publishes the corresponding public JWKS.
- Confidential `private_key_jwt` clients and client signing-key continuity are deferred and are not advertised.

### PLC Directory

- The private PLC Directory supports DID registration, resolution, updates, recovery, and audit logs.
- D1 stores the append-only PLC operation log and derived DID state.
- The PDS submits genesis operations through its private `DIRECTORY` service binding.
- Accounts reads resolved PLC state through its own `DIRECTORY` binding before activation. It does not submit operations.

### Handle Registry

- The Handle Registry is stateless and has no D1 database or registration API.
- Wildcard HTTPS routes send the request hostname to `AccountsEntrypoint` through a trusted service binding.
- `/.well-known/atproto-did` returns the DID supplied by Accounts; unknown handles return `404`.

### Town

- Town is a minimal public AT Protocol OAuth browser client on React, TanStack Router, Atcute, Vite, and a Hono Worker.
- It targets the configured public PDS, completes PAR, PKCE, DPoP, authorization-code, refresh, and identity verification through `@atcute/oauth-browser-client`, and displays the active user's handle.
- Its only service binding is `DIRECTORY`. Town exposes PLC DID documents to its browser resolver and reads `alsoKnownAs` for the displayed handle. It does not bind to Accounts or the PDS and has no database or durable storage.

### PDS

- Entryway account creation uses standard signing-key reservation and account-creation XRPC methods and supports new local accounts only.
- The PDS requires a D1-backed invite for every account creation and validates handle syntax, the DID and PLC operation, its canonical endpoint, and the reserved repository signing key. The standalone path also validates the PLC recovery key. Both paths reject primary account passwords.
- Account, refresh-token, invitation, and encrypted repository signing-key reservation state lives in PDS D1. Hosted handles live in Accounts. The PDS does not store primary account passwords.
- Signing-key reservations do not have an independent TTL. Account creation atomically binds a reservation to the derived DID, so the same DID can retry after a downstream failure and another DID cannot claim the key. Accounts stores the public signing key and pre-derived DID for status checks and retry.
- A DID-named `RepoDO` stores each repository, repository signing key, schema, and bundled migrations through `@minisphere/repo-do`. Initial signing-key, block, and final-root writes are one Durable Object SQLite transaction, and incomplete repositories from the former initialization sequence are rebuilt atomically.
- Entryway account creation validates the Accounts-created genesis PLC operation, initializes the repository with the reserved private signing key, submits the PLC operation, records the account, and issues the first PDS session JWTs.
- The PDS does not own hosted-handle uniqueness. Accounts owns username allocation and the active handle mapping.
- `PdsControlPlane.generateInviteCode()` exposes invite creation to Accounts through a named Worker RPC entrypoint. Invite generation has no public HTTP route.
- The PDS discovers Accounts OAuth verification keys from the `jwks_uri` in authorization-server metadata. Protected-resource metadata names Accounts as the authorization server.
- After full request and account-material validation, the PDS atomically claims one unexpired invitation immediately before account side effects. Invitations are bearer credentials that are not bound to DIDs and remain spent after later failures. Invite generation opportunistically removes expired rows.
- Successful account creation deletes its signing-key reservation in the same PDS D1 batch that writes the account and first refresh token.
- `getRepoStatus` requires both a PDS account record and a readable initialized repository. Sync `getRecord` reads initialized repositories. Session creation, other session methods, record mutations, repository export, and repository subscriptions are not implemented.
- PDS XRPC routes do not yet validate OAuth access JWTs, DPoP `ath`, or AT Protocol repository scopes. Future enforcement will use `@atproto/oauth-scopes`.

### Control Plane

- The Control Plane dashboard and Hono API run in one Cloudflare Worker deployment.
- The frontend is a client-rendered React SPA with TanStack Router, TanStack Query, and Base UI shadcn components. It does not use TanStack Start or SSR.
- TanStack routes use directory-based files. Route-private components live under each route's `-components` directory.
- `POST /api/accounts` gets an invite through the typed `PDS` binding and creates the PDS account. The obsolete Handle Registry binding and calls are removed so the legacy app still builds.
- One configured public `CONTROL_PLANE_ACCOUNT_RECOVERY_KEY` is included in every account's PLC genesis operation. Its private key is not stored by the application.
- Control Plane D1 records only the managed DID and a local creation timestamp. It does not duplicate the handle, PDS endpoint, session tokens, PLC document, or primary account credentials.
- The account API currently returns managed DIDs. The dashboard derives Blobatars from those DIDs and does not yet resolve handles or profile names.
- Worker code is divided into routes, services, repositories, external clients, database code, and small library functions. Shared request validation lives in `@minisphere/hono-utils`.
- Cloudflare Access is the Control Plane authorization boundary. The application has no additional session, JWT, role, or RBAC layer.

## Decisions

- Every AT Protocol identity uses the same account model. The system does not store an account type or classification.
- The PLC Directory is the source of truth for DID documents. The PDS is the source of truth for its account and session state. Accounts owns users, primary authentication, usernames, and hosted handle-to-DID mappings.
- A PLC `alsoKnownAs` value is a handle claim, not proof of the reverse mapping. The stateless Handle Registry completes reverse verification with the DID supplied by Accounts.
- The Control Plane database defines which DIDs it manages. Derived identity fields and primary account credentials do not belong in this database.
- Access and refresh JWTs are session artifacts and are not persisted by the Control Plane.
- Accounts owns OAuth authorization, refresh state, and access-token signing. The PDS is the resource server and verifies the Accounts signature, configured issuer and audience, DPoP binding, scope, and local active subject before granting access.
- Primary account authentication does not use a PDS password. Future app-password compatibility is a separate capability.
- One Durable Object hosts one DID repository and uses the DID as its object name.
- `packages/repo-do` owns `RepoDO`, repository storage, its Drizzle schema, and bundled migrations. The PDS owns global account, refresh-token, invitation, and signing-key reservation D1 state.
- Repository initialization and commit application atomically update blocks and root metadata. Initial repository creation includes its signing key in that Durable Object transaction.
- PDS D1 stores repository signing-key reservations encrypted under `PDS_SIGNING_KEY_ENCRYPTION_KEY`. A reservation is identified by its public key and atomically bound to one DID during account creation; it remains available to that DID until the local account is recorded.
- Entryway account creation follows the AT Protocol reference flow: PDS reserves the repository signing key, Accounts signs the genesis PLC operation and derives the DID, and PDS validates and registers it through standard XRPC.
- Identity-result retry is anchored by the DID and signed PLC operation stored during `provisioning`, not by a private operation ID. Unknown transport outcomes retain that material; confirmed PDS response failures release the provisional Accounts username.
- `ACCOUNTS_PLC_ROTATION_KEY` is the Entryway's PLC rotation private key. Invitation codes authorize account creation, while the PDS validates the submitted genesis operation independently of the identity of its rotation key. `PDS_ROTATION_KEY` remains the private rotation key for standalone invite-based creation.
- Migration generation commands require an explicit, readable migration name.

## Next

1. Run a deployed end-to-end account creation test through Accounts, PDS, PLC Directory, repository storage, and derived Handle Registry publication.
2. Add PDS OAuth resource-request DPoP and scope enforcement, then implement confidential `private_key_jwt` clients with signing-key continuity.
3. Implement the remaining PDS session methods, authenticated record mutations, repository export, and repository event subscriptions.
4. Configure Cloudflare Access before deploying the Control Plane.
5. Convert durable decisions in this file into ADRs.
6. Build the minimal Relay.
