# Development Notes

This file records the current implementation state and important architecture decisions. Keep entries concise and update them when a decision changes.

## 2026-08-20

### Current state

- The private PLC Directory is implemented.
- The PDS is the current focus.
- The reusable `@minisphere/repo-do` package uses `@atproto/repo` above a Durable Object SQLite storage adapter.
- Relay and Control Plane work has not started.

### Decisions

- Every AT Protocol identity uses the same account model. The system does not store an account type or classification.
- Application semantics sit above the generic protocol infrastructure.
- The Control Plane will manage accounts and PLC rotation keys.
- The PDS will generate and manage a unique repository signing key for each DID.
- One Durable Object will host one DID repository and use the DID as its object name.
- `packages/repo-do` owns `RepoDO`, its repository storage, Drizzle schema, and bundled migrations. PDS owns account D1 state and routes calls through its `REPO` binding.
- During account creation, the PDS Worker will validate Control Plane admission, generate and submit the PLC genesis operation, derive the DID, and initialize the DID-named Durable Object.
- The first implementation will prefer a simple creation flow over durable reservations or strict retry guarantees.

### Next

1. Complete password-session authentication.
2. Add authenticated record mutations and repository reads.
3. Emit repository events.
4. Build a minimal Relay and Control Plane.

## 2026-08-21

### Account creation and authentication

- Account creation uses the standard `com.atproto.server.createAccount` XRPC method. The custom `/admin/register` route is removed.
- The Control Plane generates and manages each Agent password. The PDS stores a salted PBKDF2-SHA-256 password hash produced with Web Crypto and issues the initial password-session access and refresh JWTs.
- The PDS exposes `PdsControlPlane.generateInviteCode()` through a named Worker RPC entrypoint for the Control Plane service binding. Invite generation has no public HTTP route.
- `KvKeyspace` provides prefixed KV operations and accepts only names from the strongly typed `pdsKvKeyspaces` registry. `InviteCodeRepository` composes the registered invite keyspace and owns its 32-byte random codes and two-hour expiration policy.
- Account creation requires an invite present in KV and deletes it after successful use. A deletion failure is logged but does not change a successful account response. KV propagation can take up to 60 seconds, and consumption is not atomic under concurrent requests.
- The first `createAccount` implementation supports new local accounts only. It requires a local handle, password, invite code, and one PLC recovery key; account import, email, and verification fields are rejected.
- Global account, handle, and refresh-token state lives in the PDS Worker D1 database. Each DID-owned `RepoDO` and the bundled migrations in `packages/repo-do` contain repository data only.
- The PDS creates password-session JWTs with `jose` and a separate `PDS_JWT_SECRET`, then submits the generated PLC operation through the private Directory service binding.
- Migration generation commands require an explicit, readable migration name instead of a Drizzle-generated name.

### Next

1. Implement `createSession`, `refreshSession`, `deleteSession`, and `getSession` against the stored account credentials and refresh-token state.
2. Authenticate `applyWrites` with the password-session access JWT.
3. Add handle lookup and account-creation retry handling.

### Control Plane

- The Control Plane account dashboard and Hono API are implemented in one Cloudflare Worker deployment.
- It uses a client-rendered React SPA with standalone TanStack Router and Query. TanStack Start and SSR are intentionally not used.
- UI primitives use shadcn/ui with preset `b2D0xPGVM`.
- `/accounts` manages PDS accounts without an account type or classification.

### Decisions

- Cloudflare Access protects the entire deployed Control Plane Worker. The application has no additional JWT, session, or RBAC layer, and all identities admitted by Access have equal permissions.
- Account creation is orchestrated by `POST /api/accounts` and delegated to the standard PDS `com.atproto.server.createAccount` XRPC.
- The Control Plane gets account invites from the PDS through the private `PdsControlPlane` service binding.
- The Control Plane generates a password for every account. Passwords, sessions, and PLC recovery private keys are encrypted in Control Plane D1 with AES-256-GCM.
- Account avatars are generated locally with Blobatar from the complete DID string. The MVP does not upload or store avatar blobs.
- MVP account creation has no durable reservation, retry, or reconciliation flow. Failed partial creation can leave an abandoned Durable Object or PLC DID; a later attempt creates a new DID.

### Next

1. Run an end-to-end account creation test through the Control Plane.
2. Configure Cloudflare Access for production and a deployed staging Worker.
3. Add authenticated record mutations and repository reads.
4. Emit repository events and build the minimal Relay.
