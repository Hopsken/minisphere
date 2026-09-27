# PDS

The PDS is a Hono Cloudflare Worker that serves AT Protocol XRPC. It hosts accounts created by Accounts and routes each DID to its repository Durable Object ([`@minisphere/repo-do`](../../packages/repo-do/README.md)).

The PDS owns hosted account records, invitations, repository signing-key reservations, DPoP replay state, and blob bytes. It does not own usernames, handle uniqueness, or passwords. See [ADR 0002](../../docs/adr/0002-assign-each-fact-to-one-owning-service.md).

## Account creation

Accounts creates accounts through the Worker service binding:

- `PdsControlPlane.generateInviteCode()` returns a one-time invite that expires after two hours. It has no public HTTP route.
- `com.atproto.server.reserveSigningKey` reserves a repository signing key and returns its public `did:key`.
- `com.atproto.server.createAccount` takes the invite, DID, handle, and signed genesis PLC operation. It creates the repository, submits the operation to the PLC Directory, and records the account.

After creation, the PDS announces the account on the [firehose](#firehose). A claimed invite stays spent if a later step fails. The same DID can retry with a new invite; another DID cannot claim its signing key.

## Authentication

`/.well-known/oauth-protected-resource` names Accounts as the authorization server. Write routes accept an OAuth token or an app-password session token.

An OAuth request sends `Authorization: DPoP <token>` and a `DPoP` proof. The PDS accepts the token only if:

- Accounts signed it, verified through the JWKS in the Accounts metadata;
- `iss` is Accounts, `aud` is this PDS, and its lifetime is at most five minutes;
- the DPoP proof matches the token key, method, URL, and a server nonce, and is not replayed;
- the subject is an account hosted here, and the scope grants the operation.

A missing or expired nonce returns `401` with `WWW-Authenticate: DPoP error="use_dpop_nonce"` and a new `DPoP-Nonce` header. The `atproto` scope alone grants no writes.

A password client sends `Authorization: Bearer <token>` with an app-password access token from Accounts ([ADR 0013](../../docs/adr/0013-sign-in-password-clients-with-app-passwords.md)). The PDS checks the signature, issuer, lifetime, and hosted subject as above, and requires the audience `did:web:<PDS host>`. The token grants what `transition:generic` grants; a privileged app password also grants `transition:chat.bsky`. An invalid or expired token returns `401`.

`com.atproto.server.createSession`, `refreshSession`, `getSession`, and `deleteSession` are forwarded to Accounts with only their `Authorization` and `Content-Type` headers. Accounts owns the sessions.

## Repository writes

`createRecord`, `putRecord`, `deleteRecord`, and `applyWrites` (up to 200 operations in one commit) are supported.

- `swapCommit` and `swapRecord` are checked atomically. A failed check returns `InvalidSwap` and changes nothing.
- `app.bsky.feed.post` and `app.bsky.actor.profile` are validated with the official schemas. Other collections are accepted with `validationStatus: "unknown"` unless `validate: true` is set. To validate another collection, add its schema to [`src/collections.ts`](./src/collections.ts).
- Request bodies are limited to 1,000,000 bytes, and a commit's block CAR to 2,000,000 bytes (`Commit is too large`).

Every commit is published on the [firehose](#firehose). A write succeeds even if the event cannot be published immediately; it is published later.

## Blobs

- `com.atproto.repo.uploadBlob` accepts up to 10,000,000 bytes and needs a matching `blob:` scope. The MIME type is the declared `Content-Type`; it is not sniffed.
- An uploaded blob stays private until a record references it, and it expires if no record references it within 24 hours.
- `com.atproto.sync.getBlob` and `com.atproto.sync.listBlobs` show only blobs that current records reference.

Blob bytes are stored in the private `BLOBS` R2 bucket. Do not give the bucket a public URL: that would bypass these checks.

**Storage is never reclaimed yet.** Expired, removed, and orphaned objects stay in R2. There are no quotas. Add cleanup before you open uploads widely.

## Public reads

These methods need no authentication and serve only accounts hosted here:

- `com.atproto.repo.describeRepo` — DID document, handle, and whether the handle resolves back to the DID.
- `com.atproto.repo.listRecords` — newest record keys first (default 50, maximum 100), or oldest first with `reverse=true`.
- `com.atproto.repo.getRecord` — the current record.
- `com.atproto.sync.getRecord` — a CAR proof of the record, or of its absence.
- `com.atproto.sync.getRepoStatus`.
- `com.atproto.sync.listRepos` — hosted repositories in DID order with their current commit (default 500, maximum 1000). Repositories that cannot be read are omitted.
- `com.atproto.server.describeServer` — the PDS `did:web` identity. It lists no sign-up domains and requires an invite, because accounts are created through Accounts.
- `com.atproto.sync.getLatestCommit` — the current commit CID and revision.
- `com.atproto.sync.getRepo` — the current repository as a CAR rooted at the signed commit, in the Sync 1.1 depth-first block order so consumers can process it as a stream. With `since`, only the current blocks written after that revision, to apply on top of the repository at `since`. Deleted records are never included.

Keep the `global_fetch_strictly_public` compatibility flag enabled. Without it, handle resolution cannot reach Accounts routes in the same Cloudflare zone.

## Firehose

`com.atproto.sync.subscribeRepos` streams repository events over a WebSocket. A request without a WebSocket upgrade receives `426`. See [ADR 0012](../../docs/adr/0012-sequence-repository-events-in-one-durable-object.md).

- `#commit` events follow sync 1.1: `since` and `prevData` name the previous commit, and `ops` are the net change per record path, with `prev` on updates and deletes. The CAR contains everything needed to verify the signature and invert the ops onto `prevData`.
- A new account emits `#identity`, `#account` (active), and `#sync` with its current commit.
- `seq` increases across the whole PDS and is never reused.
- Without `cursor`, a consumer receives new events only. With `cursor`, it first receives every retained event after that `seq`.
- Events are retained for 72 hours. An older cursor first receives `#info` `OutdatedCursor`, then the oldest retained events; the consumer must resynchronize with `com.atproto.sync.getRepo`. A cursor beyond the latest `seq` receives a `FutureCursor` error and close code `1008`.

Handle changes and account status changes do not emit events yet.

## Preferences

`app.bsky.actor.getPreferences` and `putPreferences` store the account's `app.bsky` preferences on the PDS ([ADR 0014](../../docs/adr/0014-store-actor-preferences-on-the-pds.md)). They need a session with RPC permission for the Bluesky AppView, as proxied methods do.

- `putPreferences` replaces the stored list. Every preference must be in the `app.bsky` namespace.
- `personalDetailsPref` requires full account access, which no session has, so it is rejected and never returned. Accounts sets the birth date instead, with `PdsControlPlane.getBirthDate(did)` and `setBirthDate(did, date)`. `putPreferences` does not change it.
- `declaredAgePref` is dropped on write. `getPreferences` derives it from the birth date when one is set.
- With an `atproto-proxy` header for another AppView, both methods are proxied instead.

## Service proxying

Methods this PDS does not implement are sent to another service as the signed-in account:

- The target is the `atproto-proxy` header (`<did>#<service id>`). Without the header, `app.bsky.*` goes to `did:web:api.bsky.app#bsky_appview` and `chat.bsky.*` to `did:web:api.bsky.chat#bsky_chat`. Other methods return `501 MethodNotImplemented`.
- The service endpoint comes from the target's DID document and must use HTTPS. Endpoints are cached for ten minutes.
- The request needs a session with RPC permission for the target and method. App-password sessions have it for every service except `chat.bsky.*`, which needs a privileged app password. OAuth sessions have no RPC permissions yet.
- The PDS forwards only the query, body, `Content-Type`, `Content-Encoding`, `Accept-Language`, `atproto-accept-labelers`, `x-bsky-topics`, and `x-atproto-*` headers. It adds a service JWT signed by the account's repository key with a one-minute lifetime. The upstream status and body are returned unchanged with `Content-Type`, `atproto-content-labelers`, `atproto-repo-rev`, and `Retry-After`.
- The method must be a normalized NSID (lowercase authority). Methods in `com.atproto.admin`, `com.atproto.identity`, `com.atproto.server`, and `com.atproto.temp` manage accounts; they are never proxied, including methods added to these namespaces later.

`com.atproto.server.getServiceAuth` returns the same kind of service JWT for an `aud` and an `lxm`, under the same method rules. `lxm` is required: a token without it would be valid for every method of the audience. `exp` can be at most one hour ahead.

## Configuration

Bindings: `PDS_DB` (D1), `REPO` (repository Durable Objects), `SEQUENCER` (the firehose Durable Object from [`@minisphere/pds-sequencer-do`](../../packages/pds-sequencer-do/README.md)), and `BLOBS` (R2).

Variables:

- `MINISPHERE_ORIGIN` — required. The Accounts origin; the PDS origin is `pds.<hostname>`.
- `PLC_DIRECTORY` — optional; defaults to `https://plc.directory`. Use the same value as Accounts and Town.
- `PDS_ORIGIN` — optional override, used locally.

Secrets:

- `PDS_JWT_SECRET` — at least 32 random bytes. It signs the session tokens that `createAccount` returns.
- `PDS_ENCRYPTION_KEY` — at least 32 random characters. It encrypts reserved signing keys in D1. Changing it makes unclaimed reservations unreadable.

Set production values in the Cloudflare Dashboard. See the [deployment guide](../../docs/DEPLOYMENT.md).

## Development

```sh
pnpm setup:local
pnpm dev:pds
pnpm turbo test typecheck build --filter=@minisphere/pds
```

The PDS runs at `http://localhost:8787` with the local Directory on port `8788`.

To change the D1 schema in `src/db/schema.ts`, create and apply a named migration:

```sh
pnpm --filter @minisphere/pds db:generate add-account-column
pnpm --filter @minisphere/pds db:migrate:local
```
