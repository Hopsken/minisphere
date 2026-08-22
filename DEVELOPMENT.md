# Development Notes

This file records the current implementation state and important architecture decisions. Keep entries concise and update them when a decision changes.

## 2026-08-20

### Current state

- The private PLC Directory is implemented.
- The PDS is the current focus.
- The reusable `@minisphere/repo-do` package uses `@atproto/repo` above a Durable Object SQLite storage adapter.
- Relay and Agent Control Plane work has not started.

### Decisions

- AT Protocol identities do not distinguish humans from AI agents.
- Custom Lexicons will define human and agent collaboration above the generic protocol infrastructure.
- The Control Plane will manage system-operated agents and PLC rotation keys.
- The PDS will generate and manage a unique repository signing key for each DID.
- One Durable Object will host one DID repository and use the DID as its object name.
- `packages/repo-do` owns `RepoDO`, its repository storage, Drizzle schema, and bundled migrations. PDS owns account D1 state and routes calls through its `REPO` binding.
- During account creation, the PDS Worker will validate Control Plane admission, generate and submit the PLC genesis operation, derive the DID, and initialize the DID-named Durable Object.
- The first implementation will prefer a simple creation flow over durable reservations or strict retry guarantees.

### Next

1. Complete password-session authentication.
2. Add authenticated record mutations and repository reads.
3. Emit repository events.
4. Build a minimal Relay and Agent Control Plane.

## 2026-08-21

### Account creation and authentication

- Account creation uses the standard `com.atproto.server.createAccount` XRPC method. The custom `/admin/register` route is removed.
- The Control Plane generates and manages each Agent password. The PDS stores a salted PBKDF2-SHA-256 password hash produced with Web Crypto and issues the initial password-session access and refresh JWTs.
- The PDS exposes `PdsControlPlane.generateInviteCode()` through a named Worker RPC entrypoint for the Control Plane service binding. Invite generation has no public HTTP route.
- Each invite is 32 random bytes encoded as unpadded base64url and stored with an `invite:` key prefix in the general-purpose `PDS_KV` namespace with a two-hour expiration.
- Account creation requires an invite present in KV and deletes it after successful use. KV propagation can take up to 60 seconds, and consumption is not atomic under concurrent requests.
- The first `createAccount` implementation supports new local accounts only. It requires a local handle, password, invite code, and one PLC recovery key; account import, email, and verification fields are rejected.
- Global account, handle, and refresh-token state lives in the PDS Worker D1 database. Each DID-owned `RepoDO` and the bundled migrations in `packages/repo-do` contain repository data only.
- The PDS creates password-session JWTs with `jose` and a separate `PDS_JWT_SECRET`, then submits the generated PLC operation through the private Directory service binding.
- Migration generation commands require an explicit, readable migration name instead of a Drizzle-generated name.

### Next

1. Implement `createSession`, `refreshSession`, `deleteSession`, and `getSession` against the stored account credentials and refresh-token state.
2. Authenticate `applyWrites` with the password-session access JWT.
3. Add handle lookup and account-creation retry handling.
