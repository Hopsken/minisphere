# PDS

The PDS is a Hono Cloudflare Worker that serves AT Protocol XRPC. It hosts accounts created by Accounts and routes each DID to its repository Durable Object ([`@minisphere/repo-do`](../../packages/repo-do/README.md)).

The PDS owns hosted account records, invitations, repository signing-key reservations, DPoP replay state, and blob bytes. It does not own usernames, handle uniqueness, or passwords. See [ADR 0002](../../docs/adr/0002-assign-each-fact-to-one-owning-service.md).

## Account creation

Accounts creates accounts through the Worker service binding:

- `PdsControlPlane.generateInviteCode()` returns a one-time invite that expires after two hours. It has no public HTTP route.
- `com.atproto.server.reserveSigningKey` reserves a repository signing key and returns its public `did:key`.
- `com.atproto.server.createAccount` takes the invite, DID, handle, and signed genesis PLC operation. It creates the repository, submits the operation to the PLC Directory, and records the account.

A claimed invite stays spent if a later step fails. The same DID can retry with a new invite; another DID cannot claim its signing key.

## Authentication

`/.well-known/oauth-protected-resource` names Accounts as the authorization server. Write routes require `Authorization: DPoP <token>` and a `DPoP` proof. The PDS accepts a token only if:

- Accounts signed it, verified through the JWKS in the Accounts metadata;
- `iss` is Accounts, `aud` is this PDS, and its lifetime is at most five minutes;
- the DPoP proof matches the token key, method, URL, and a server nonce, and is not replayed;
- the subject is an account hosted here, and the scope grants the operation.

A missing or expired nonce returns `401` with `WWW-Authenticate: DPoP error="use_dpop_nonce"` and a new `DPoP-Nonce` header. The `atproto` scope alone grants no writes.

## Repository writes

`createRecord`, `putRecord`, `deleteRecord`, and `applyWrites` (up to 200 operations in one commit) are supported.

- `swapCommit` and `swapRecord` are checked atomically. A failed check returns `InvalidSwap` and changes nothing.
- `app.bsky.feed.post` and `app.bsky.actor.profile` are validated with the official schemas. Other collections are accepted with `validationStatus: "unknown"` unless `validate: true` is set. To validate another collection, add its schema to [`src/collections.ts`](./src/collections.ts).
- Request bodies are limited to 1,000,000 bytes, and a commit's block CAR to 2,000,000 bytes (`Commit is too large`).

No repository events are emitted yet.

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
- `com.atproto.sync.getLatestCommit` — the current commit CID and revision.
- `com.atproto.sync.getRepo` — the current repository as a CAR rooted at the signed commit. With `since`, only the current blocks written after that revision, to apply on top of the repository at `since`. Deleted records are never included.

Session methods are not implemented.

Keep the `global_fetch_strictly_public` compatibility flag enabled. Without it, handle resolution cannot reach Accounts routes in the same Cloudflare zone.

## Configuration

Bindings: `PDS_DB` (D1), `REPO` (repository Durable Objects), and `BLOBS` (R2).

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
