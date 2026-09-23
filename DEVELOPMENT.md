# Development Notes

This file records the current implementation state and important architecture decisions. Keep entries concise and update them when a decision changes.

## Current state — 2026-09-23

### Accounts

- The Accounts app is the account and primary authentication authority on a Hono Worker, Better Auth, and D1.
- Its frontend uses Vite, TanStack Router, TanStack Query, Tailwind CSS, and Base UI shadcn conventions.
- It authenticates users with six-digit email login codes sent through Resend. Codes expire after ten minutes, allow five attempts, and use a 60-second resend cooldown. `EMAIL_ALLOWLIST` controls registration and login through exact domains, exact addresses, or `*`. Verified new users register automatically. Passwords, email changes, recovery, and OIDC user transition are not implemented. AT Protocol OAuth remains separate and enabled.
- Each Better Auth user has zero or one `atproto_account`. That record reserves one permanent normalized username and becomes active with one immutable DID. Hosted handles use the `MINISPHERE_ORIGIN` hostname unless `PUBLIC_HANDLE_DOMAIN` explicitly overrides it.
- Account completion uses `needs_username`, `provisioning`, and `active` states. Once identity material is saved, both transport and PDS response failures retain it for status checks and retry; a concurrent create may still complete. Only an empty matching username reservation can be released on failure.
- Accounts gets one-time account invites from `PdsControlPlane.generateInviteCode()` and provisions through standard `com.atproto.server.reserveSigningKey` and `com.atproto.server.createAccount` XRPC methods exposed by `PdsControlPlane.fetch()`.
- Accounts directly serves active-only hosted-handle resolution: `GET /.well-known/atproto-did` uses the request hostname, and `GET /xrpc/com.atproto.identity.resolveHandle` uses its `handle` parameter. Only the XRPC response has CORS; neither route uses login or session state.
- Reserved usernames are enforced in the worker repository for both availability and reservation after normalization. Exact reserved matches return the same unavailable result (`false` or `409`) as any taken username; the frontend schema is not authoritative.
- Accounts generates a separate secp256k1 PLC rotation key per account. One conditional D1 write saves the encrypted key, random IV, signed genesis operation, derived DID, and public repository key. Concurrent requests use the persisted winner; retries do not reconstruct the operation. Keys remain encrypted after activation. Activation requires matching PDS repository and PLC state.
- Accounts provides the public-client AT Protocol OAuth authorization-code flow through a dedicated Better Auth plugin. App passwords are not implemented.
- OAuth protocol and replay state uses database-backed Better Auth verification records. Consent binds one server-resolved active DID to the current user. A React route renders server-validated consent details; the browser does not select or submit a DID.
- Accounts accepts `atproto` and generic repository collection/action permissions validated by `@atproto/oauth-scopes`. Static discovery scopes do not enumerate dynamic repository permissions. Client metadata must declare each requested scope; consent and refresh preserve the grant without expansion. Friendly collection names are a display-only map, not an authorization allowlist. Permission-set resolution (`include:`) and non-repository permissions remain unsupported.
- Accounts initializes a dedicated OAuth secp256k1 key on first use and persists it in its D1 `oauth_signing_key` table. An atomic empty-table insert and a unique current-key index select one winner across Worker instances; all key queries go to the D1 primary without the Sessions API. AES-GCM encrypts private material under the independent `ACCOUNTS_ENCRYPTION_KEY`, binding purpose and `kid`. Signing fails closed on storage or decryption errors. JWKS publishes current and retired public keys without decryption and excludes disabled keys; scheduled rotation is not implemented.
- Confidential `private_key_jwt` clients and client signing-key continuity are deferred and are not advertised.

### PLC Directory

- Accounts, PDS, and Town use HTTP for PLC access, without Directory service bindings. Each defaults an omitted `PLC_DIRECTORY` to `https://plc.directory` in its own Zod schema. Invalid explicit values fail validation, and request failures never switch directories. Local templates explicitly use `http://localhost:8788` to avoid persistent public writes.
- The private PLC Directory supports DID registration, resolution, updates, recovery, and audit logs.
- D1 stores the append-only PLC operation log and derived DID state.
- The PDS submits genesis operations to the configured Directory.
- Accounts reads resolved PLC state from that Directory before activation. Authenticated users can read and correct their own live PLC PDS endpoint through `GET/PATCH /api/account/plc` and a separate Settings page. Rotation-key editing is not supported. Updates preserve the other live PLC fields, stored genesis, and encrypted rotation key. PATCH requires same-origin headers and an expected head. Signing requires the managed key to have lowest priority at the current head, so a submission race cannot become an unintended PLC recovery. Accounts reads back after all submission attempts and never automatically resubmits. See the Accounts README for the interface and recovery limits.

### Town example

- Town is a minimal external AT Protocol OAuth browser client on React, TanStack Router, Atcute, Vite, and a Hono Worker.
- It accepts a handle, DID, or PDS URL, uses standard identity and authorization-server discovery through `@atcute/oauth-browser-client`, and requests only `atproto` plus create permission for `app.bsky.feed.post`. Older read-only sessions need fresh consent.
- Town selects one PLC Directory origin and reaches it through HTTP. Its same-origin handle endpoint uses standard DNS and HTTPS resolution for public handles and a local XRPC adapter for `.test` handles.
- Town has no server database. The browser stores OAuth sessions through Atcute, plus per-DID drafts and pending record keys in local storage. `@atcute/client` and `OAuthUserAgent` write pure-text posts directly to the real account PDS; public reads use that same PDS. Official Bluesky schemas validate records. Stable TID keys and readback checks prevent blind duplicate writes after uncertain results; confirmed writes retry reads only. Reloads load the most recent 10 posts in descending repository-key order; successful posts refresh that list.
- The simplified composer and recovery paths are covered by automated tests and mock browser checks. Real account OAuth and posting still require user verification; an orb portal must be temporarily public so external authorization servers can fetch client metadata. See the Town README.

### PDS

- Entryway account creation uses standard signing-key reservation and account-creation XRPC methods and supports new local accounts only.
- The PDS validates the standard account-creation lexicon input and required Entryway material shape, and requires a D1-backed invite. It trusts Accounts to supply the Entryway-derived DID, PLC operation, and reserved repository signing key, and ignores unused standard account fields.
- Account, refresh-token, invitation, and encrypted repository signing-key reservation state lives in PDS D1. Hosted handles live in Accounts. The PDS does not store primary account passwords.
- Signing-key reservations do not have an independent TTL. Account creation atomically binds a reservation to the derived DID, so the same DID can retry after a downstream failure and another DID cannot claim the key. Accounts stores the public signing key and pre-derived DID for status checks and retry.
- A DID-named `RepoDO` stores each repository, repository signing key, schema, and bundled migrations through `@minisphere/repo-do`. Initial signing-key, block, and final-root writes are one Durable Object SQLite transaction, and incomplete repositories from the former initialization sequence are rebuilt atomically.
- Entryway account creation uses the Accounts-created genesis PLC operation, initializes the repository with the reserved private signing key, submits the PLC operation, records the account, and issues the first PDS session JWTs.
- The PDS does not own hosted-handle uniqueness. Accounts owns username allocation and the active handle mapping.
- `PdsControlPlane.generateInviteCode()` exposes invite creation to Accounts through a named Worker RPC entrypoint. Invite generation has no public HTTP route.
- The PDS discovers Accounts OAuth verification keys from the `jwks_uri` in authorization-server metadata. Protected-resource metadata names Accounts as the authorization server.
- After request-shape validation, the PDS atomically claims one unexpired invitation before account side effects. Invitations are bearer credentials that are not bound to DIDs and remain spent after later failures. Invite generation opportunistically removes expired rows.
- Successful account creation deletes its signing-key reservation in the same PDS D1 batch that writes the account and first refresh token.
- `getRepoStatus` requires both a PDS account record and a readable initialized repository. Anonymous `describeRepo`, `listRecords`, and repo `getRecord` expose current records for local accounts, with handle/DID resolution and bidirectional handle verification in descriptions. Sync `getRecord` streams signed inclusion/exclusion CAR proofs through the existing repository library. Session creation, other session methods, blob access, repository export, and repository subscriptions are not implemented.
- Authenticated `createRecord`, `putRecord`, `deleteRecord`, and `applyWrites` use one RepoDO write queue and atomic commit path, including head/record CAS checks. Batches support up to 200 ordered writes. Block SQL is chunked within the transaction to respect SQLite binding limits. Tests cover concurrency, storage rollback, readback after eviction, and signed CAR records.
- Write requests verify Accounts access JWTs, local subjects, ES256 DPoP key/token/method/URL binding, server nonce, and proof freshness. PDS D1 owns five-minute nonce and replay records with atomic proof claims. CORS exposes challenge headers. `@atproto/oauth-scopes` enforces collection/action grants; legacy session JWTs do not authorize writes.
- Record validation uses the official Atcute `app.bsky.feed.post` schema. Unknown Lexicons are accepted only when validation is not explicitly required, with `unknown` status. Blob references are rejected. Write bodies, nesting, and commit proof size are bounded; no remote Lexicon discovery or subscription event emission is implemented.

## Decisions

- Cloudflare Dashboard owns production runtime variables, secrets, and routes; Wrangler preserves them with `keep_vars` and no route declarations. Project-local `.dev.vars.example` files define local defaults and variable names for type generation. D1 and service bindings remain in Wrangler configuration. See [configuration ownership](./docs/LOCAL_DEVELOPMENT.md#configuration-ownership).
- Every AT Protocol identity uses the same account model. The system does not store an account type or classification.
- The PLC Directory is the source of truth for DID documents. The PDS is the source of truth for its account and session state. Accounts owns users, primary authentication, usernames, and hosted handle-to-DID mappings.
- A PLC `alsoKnownAs` value is a handle claim, not proof of the reverse mapping. Accounts completes reverse verification directly from its active mapping.
- Accounts and PDS each own their configuration resolver and Zod schema. Both require `MINISPHERE_ORIGIN` and derive the Accounts and `pds.<hostname>` origins. Only Accounts configures the hosted-handle suffix. Local development overrides the PDS origin and Accounts handle suffix. Each `resolveConfig()` reads `cloudflare:workers` environment bindings on demand. Their schemas default an omitted `PLC_DIRECTORY` to `https://plc.directory`; explicit invalid values still fail, and neither request failures nor explicit private origins fall back to another directory. Town applies the same directory default and failure rules in its own configuration schema.
- Accounts and PDS expose `GET /health` as configuration-validation probes. A successful response means only that current configuration is valid, not that databases, service bindings, the PLC Directory, or other dependencies are available. Invalid configuration returns a generic error.
- Accounts owns OAuth authorization, refresh state, and access-token signing. The PDS is the resource server and verifies the Accounts signature, configured issuer and audience, DPoP binding, scope, and local active subject before granting access.
- Primary account authentication does not use a PDS password. Future app-password compatibility is a separate capability.
- One Durable Object hosts one DID repository and uses the DID as its object name.
- `packages/repo-do` owns `RepoDO`, repository storage, its Drizzle schema, and bundled migrations. The PDS owns global account, refresh-token, invitation, and signing-key reservation D1 state.
- Repository initialization and commit application atomically update blocks and root metadata. Initial repository creation includes its signing key in that Durable Object transaction.
- PDS D1 stores repository signing-key reservations encrypted under `PDS_ENCRYPTION_KEY`. A reservation is identified by its public key and atomically bound to one DID during account creation; it remains available to that DID until the local account is recorded.
- Entryway account creation follows the AT Protocol reference flow: PDS reserves the repository signing key, Accounts signs the genesis PLC operation and derives the DID, and PDS trusts and registers that material through standard XRPC.
- Identity-result retry is anchored by the DID and signed PLC operation stored during `provisioning`, not by a private operation ID. All failures after material persistence retain it to protect concurrent external creation. D1 sessions start on the primary and provide read-after-write consistency.
- `ACCOUNTS_ENCRYPTION_KEY` encrypts per-account PLC rotation keys with AES-GCM and purpose/account-bound authenticated data. This is server-managed custody, not protection from service administrators. Invitation codes authorize account creation, and Accounts owns the correctness of the submitted genesis operation.
- Migration generation commands require an explicit, readable migration name.

## Next

1. Run a deployed end-to-end account creation test through Accounts, PDS, PLC Directory, repository storage, and Accounts handle publication.
2. Implement confidential `private_key_jwt` clients with signing-key continuity.
3. Implement the remaining PDS session methods, repository export, blob storage, and repository event subscriptions.
4. Convert durable decisions in this file into ADRs.
5. Build the minimal Relay.
