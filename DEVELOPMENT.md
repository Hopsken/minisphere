# Development Notes

This file records the current implementation state and important architecture decisions. Keep entries concise and update them when a decision changes.

## Current state — 2026-08-25

### Accounts

- The Accounts app is a standalone React SPA and Better Auth scaffold on a Hono Worker and D1.
- Its frontend environment matches the Control Plane stack: Vite, TanStack Router, TanStack Query, Tailwind CSS, and Base UI shadcn conventions.
- It mounts the default Better Auth API and stores only the core Better Auth user, session, linked account, and verification records.
- No sign-in method, authentication screen, role model, DID mapping, AT Protocol OAuth flow, app-password flow, or integration with another Minisphere service is implemented.

### PLC Directory

- The private PLC Directory supports DID registration, resolution, updates, recovery, and audit logs.
- D1 stores the append-only PLC operation log and derived DID state.
- The PDS submits genesis operations through its private `DIRECTORY` service binding.

### Handle Registry

- D1 owns the handle-to-DID mapping and registration timestamp.
- `HandleRegistryEntrypoint` exposes availability checks and administrative registration through a Worker service binding.
- Wildcard HTTPS routes resolve registered handles through `/.well-known/atproto-did`; unknown handles return `404`.
- Registration accepts one label under the configured domain, validates handle and DID syntax, and rejects reserved labels. Administrative override registration uses a D1 upsert.

### PDS

- Account creation uses `com.atproto.server.createAccount` and supports new local accounts only.
- The PDS validates handle syntax, password, KV-backed invite code, and PLC recovery key.
- Account and refresh-token state lives in PDS D1. Handles live in the Handle Registry. Passwords use salted PBKDF2-SHA-256 hashes.
- A DID-named `RepoDO` stores each repository, repository signing key, schema, and bundled migrations through `@minisphere/repo-do`.
- Account creation generates the repository key, creates and submits the PLC genesis operation, initializes the repository, and issues the first access and refresh JWTs.
- `PdsControlPlane.generateInviteCode()` exposes invite creation through a named Worker RPC entrypoint. Invite generation has no public HTTP route.
- Successful account creation removes the invite from KV. Cleanup failure is logged without changing the successful account response.
- `getRepoStatus` and sync `getRecord` read initialized repositories. Session creation, other session methods, record mutations, repository export, and repository subscriptions are not implemented.

### Control Plane

- The Control Plane dashboard and Hono API run in one Cloudflare Worker deployment.
- The frontend is a client-rendered React SPA with TanStack Router, TanStack Query, and Base UI shadcn components. It does not use TanStack Start or SSR.
- TanStack routes use directory-based files. Route-private components live under each route's `-components` directory.
- `POST /api/accounts` checks handle availability through the typed `HandleRegistry` binding, gets an invite through the typed `PDS` binding, creates the PDS account, and registers its handle through an administrative upsert.
- One configured public `CONTROL_PLANE_ACCOUNT_RECOVERY_KEY` is included in every account's PLC genesis operation. Its private key is not stored by the application.
- Control Plane D1 records only the managed DID, the encrypted generated password, and a local creation timestamp. It does not duplicate the handle, PDS endpoint, session tokens, or PLC document.
- Passwords are compact JWE values encrypted with direct A256GCM through `jose`. The protected header binds each value to its DID. The encryption key is a separate Worker secret.
- The account API currently returns managed DIDs. The dashboard derives Blobatars from those DIDs and does not yet resolve handles or profile names.
- Worker code is divided into routes, services, repositories, external clients, database code, and small library functions. Shared request validation lives in `@minisphere/hono-utils`.
- Cloudflare Access is the Control Plane authorization boundary. The application has no additional session, JWT, role, or RBAC layer.

## Decisions

- Every AT Protocol identity uses the same account model. The system does not store an account type or classification.
- The PLC Directory is the source of truth for DID documents. The PDS is the source of truth for account and authentication state.
- A PLC `alsoKnownAs` value is a handle claim, not proof of the reverse mapping. The Handle Registry is the source of truth for managed handle-to-DID resolution.
- The Control Plane database defines which DIDs it manages and stores the generated password needed for future PDS authentication. Derived identity fields do not belong in this database.
- Access and refresh JWTs are session artifacts and are not persisted by the Control Plane.
- Recoverable credentials use standard JWE instead of a custom encryption envelope.
- One Durable Object hosts one DID repository and uses the DID as its object name.
- `packages/repo-do` owns `RepoDO`, repository storage, its Drizzle schema, and bundled migrations. The PDS owns global account and refresh-token D1 state.
- Account creation favors a simple flow over durable handle reservations, retries, or reconciliation. Partial failure can leave an abandoned DID, repository, or unverified handle claim. Rare concurrent handle claims use the final administrative registry upsert.
- Migration generation commands require an explicit, readable migration name.

## Next

1. Run an end-to-end account creation test through the Control Plane, PDS, and PLC Directory.
2. Implement PDS session creation and refresh, then use the stored Control Plane password when authentication is required.
3. Add authenticated record mutations, repository export, and repository event subscriptions.
4. Configure Cloudflare Access before deploying the Control Plane.
5. Convert durable decisions in this file into ADRs.
6. Build the minimal Relay.
