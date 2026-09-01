# Development Notes

This file records the current implementation state and important architecture decisions. Keep entries concise and update them when a decision changes.

## Current state — 2026-08-29

### Accounts

- The Accounts app is the account and primary authentication authority on a Hono Worker, Better Auth, and D1.
- Its frontend environment matches the Control Plane stack: Vite, TanStack Router, TanStack Query, Tailwind CSS, and Base UI shadcn conventions.
- It stores Better Auth records, user-to-user ownership relationships, normalized usernames, and DIDs. Managed handles are derived from usernames and `PUBLIC_HANDLE_DOMAIN`.
- Authenticated users can provision related AT Protocol users through the PDS binding. Accounts stores the returned DID and exposes authoritative handle resolution through `AccountsEntrypoint`.
- Public Better Auth sign-up is disabled. Accounts provides the public-client AT Protocol OAuth authorization-code flow through a dedicated Better Auth plugin. App passwords are not implemented.
- OAuth protocol and replay state uses database-backed Better Auth verification records. The Better Auth owner selects one related managed DID without changing the browser session to the related user.
- Confidential `private_key_jwt` clients and client signing-key continuity are deferred and are not advertised.

### PLC Directory

- The private PLC Directory supports DID registration, resolution, updates, recovery, and audit logs.
- D1 stores the append-only PLC operation log and derived DID state.
- The PDS submits genesis operations through its private `DIRECTORY` service binding.

### Handle Registry

- The Handle Registry is stateless and has no D1 database or registration API.
- Wildcard HTTPS routes send the request hostname to `AccountsEntrypoint` through a trusted service binding.
- `/.well-known/atproto-did` returns the DID supplied by Accounts; unknown handles return `404`.

### PDS

- Account creation uses `com.atproto.server.createAccount` and supports new local accounts only.
- The PDS validates handle syntax, the KV-backed invite code, and the PLC recovery key. It rejects primary account passwords.
- Account and refresh-token state lives in PDS D1. Managed handles live in Accounts. The PDS does not store primary account passwords.
- A DID-named `RepoDO` stores each repository, repository signing key, schema, and bundled migrations through `@minisphere/repo-do`.
- Account creation generates the repository key, creates and submits the PLC genesis operation, initializes the repository, and issues the first access and refresh JWTs.
- `PdsControlPlane.generateInviteCode()` exposes invite creation to Accounts through a named Worker RPC entrypoint. Invite generation has no public HTTP route.
- `PdsControlPlane.issueOAuthAccessToken()` creates access JWTs with the selected DID, PDS audience, OAuth scope and client ID, and DPoP key thumbprint. Protected-resource metadata names Accounts as the authorization server.
- Successful account creation removes the invite from KV. Cleanup failure is logged without changing the successful account response.
- `getRepoStatus` and sync `getRecord` read initialized repositories. Session creation, other session methods, record mutations, repository export, and repository subscriptions are not implemented.
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
- The PLC Directory is the source of truth for DID documents. The PDS is the source of truth for its account and session state. Accounts owns users, primary authentication, usernames, and managed handle-to-DID mappings.
- A PLC `alsoKnownAs` value is a handle claim, not proof of the reverse mapping. The stateless Handle Registry completes reverse verification with the DID supplied by Accounts.
- The Control Plane database defines which DIDs it manages. Derived identity fields and primary account credentials do not belong in this database.
- Access and refresh JWTs are session artifacts and are not persisted by the Control Plane.
- The PDS signs OAuth access JWTs. Accounts owns authorization and refresh state but cannot mint a token for a different issuer or resource audience.
- Primary account authentication does not use a PDS password. Future app-password compatibility is a separate capability.
- One Durable Object hosts one DID repository and uses the DID as its object name.
- `packages/repo-do` owns `RepoDO`, repository storage, its Drizzle schema, and bundled migrations. The PDS owns global account and refresh-token D1 state.
- Account creation favors a simple flow over idempotency or reconciliation. Partial failure can leave an abandoned PDS DID or repository, or an incomplete Accounts user.
- Migration generation commands require an explicit, readable migration name.

## Next

1. Run an end-to-end account creation and handle verification test through Accounts, PDS, PLC Directory, and Handle Registry.
2. Add PDS OAuth resource-request DPoP and scope enforcement, then implement confidential `private_key_jwt` clients with signing-key continuity.
3. Implement the remaining PDS session methods, authenticated record mutations, repository export, and repository event subscriptions.
4. Configure Cloudflare Access before deploying the Control Plane.
5. Convert durable decisions in this file into ADRs.
6. Build the minimal Relay.
