# PDS

The PDS is a Hono Cloudflare Worker that exposes AT Protocol XRPC routes. It owns PDS account and session state and routes each DID to its repository Durable Object.

## Data ownership and bindings

- PDS D1 stores active account DIDs, refresh-token records, short-lived account invitation codes and expiry times, and encrypted repository signing-key reservations. It does not store OIDC identities, usernames, or primary account passwords.
- [`@minisphere/repo-do`](../../packages/repo-do/README.md) owns repository data and repository signing keys.
- PLC genesis operations and recovery reads use HTTP at `PLC_DIRECTORY`, which defaults to `https://plc.directory` when omitted. Accounts and Town must use the same directory. Invalid explicit values fail configuration validation, and failed requests do not switch to another directory.
- `PdsControlPlane.generateInviteCode()` is a named RPC entrypoint for Accounts.
- `PdsControlPlane.fetch()` exposes the standard PDS XRPC routes to trusted service bindings.

Account creation accepts a syntactically valid handle and records it as an `alsoKnownAs` claim in the PLC genesis operation. The resolved PDS origin is the canonical public HTTPS origin used for the DID document service endpoint and session JWT audience; these values do not depend on the incoming request URL. The PDS does not prove or publish the reverse mapping; Accounts owns and directly serves hosted handle mappings.

### Entryway provisioning

Entryway provisioning uses the standard AT Protocol methods:

1. `com.atproto.server.reserveSigningKey` generates a repository signing key. The PDS stores the private multikey encrypted in D1 and returns only its public `did:key`. The reservation has no independent time-to-live.
2. Accounts creates and signs the genesis PLC operation with its own rotation key and derives the expected `did:plc` before account creation.
3. Accounts gets a one-time invite through `PdsControlPlane.generateInviteCode()`. `com.atproto.server.createAccount` receives that invite, DID, handle, and PLC operation. The PDS validates the standard lexicon input and required Entryway material shape, then trusts the Accounts-supplied identity material. It atomically claims the unexpired invite in D1 and binds the requested signing-key reservation to the supplied DID.
4. The PDS atomically initializes the DID-named repository, submits the PLC operation, and records the local account. The signing-key reservation remains available to the same DID after a downstream failure. After success, its deletion is in the same D1 batch as the account and refresh token. Accounts independently verifies PDS repository and PLC state before activation.

An invitation is a bearer credential that proves authorization through the trusted provisioning binding. It is not bound to a DID. Its D1 row contains the code and expiry time. A claimed invitation remains spent if a later account-creation side effect fails; Accounts requests a new invitation for a retry. New invitation generation opportunistically removes expired rows.

The PDS does not allocate or enforce hosted-handle uniqueness. Accounts owns that policy. A retry after an unknown response uses the same pre-derived DID and signed PLC operation. Repository reservation and PLC submission tolerate already-completed side effects, while Accounts checks `com.atproto.sync.getRepoStatus` and resolved PLC state before sending another create request.

## OAuth resource contract

`/.well-known/oauth-protected-resource` identifies the resolved PDS origin as the resource and Accounts origin as its authorization server. Accounts signs maximum-five-minute ES256K access JWTs and advertises its `jwks_uri` through authorization-server metadata. The PDS discovers the JWT `kid` from that JWKS and verifies these claims:

- selected DID in `sub`;
- PDS origin in `aud`;
- Accounts origin in `iss`;
- current authorization scope in `scope`;
- OAuth client ID in `client_id`;
- DPoP JWK thumbprint in `cnf.jkt`.

Accounts revocation stops refresh and new token issuance. An already issued access JWT can remain valid until its five-minute expiry. On protected resource requests, the PDS must also confirm that `sub` is a local active account; token signature verification alone is not account authorization.

PDS XRPC routes do not yet accept these OAuth tokens or enforce repository permissions. Resource-request DPoP verification, including `ath`, and scope enforcement are the next PDS milestone. That work must use `@atproto/oauth-scopes` for AT Protocol permission checks; OAuth client scope builders do not enforce permissions.

## Public repository reads

The following methods accept anonymous requests for locally registered accounts:

- `com.atproto.repo.describeRepo` returns the DID document, claimed handle, reverse-handle verification result, and collections with current records. DID documents use `PLC_DIRECTORY` for `did:plc` and HTTPS resolution for `did:web`; handles use DNS-over-HTTPS and HTTPS resolution through Atcute.
- `com.atproto.repo.listRecords` returns current records in descending rkey order by default, or ascending order with `reverse=true`. The default limit is 50, the maximum is 100, and the cursor is an exclusive rkey boundary. An empty collection returns an empty list. Pagination follows the current repository on each request; it is not a historical snapshot.
- `com.atproto.repo.getRecord` returns the current record's URI, CID, and Lexicon JSON value. An optional CID must match the current version; this is not a historical record API.
- `com.atproto.sync.getRecord` streams a CAR containing the signed commit, MST path, and the requested record block. An absent record produces an exclusion proof, not a JSON null response.

Repository reads accept a DID or handle; sync reads accept a DID. Reads do not forward to remote PDS servers or expose repositories left behind by incomplete provisioning. PDSls can use the first three methods without login, then use the CAR endpoint to verify a record. Blob browsing and full repository export are not implemented yet.

Tests seed disposable repositories directly in the Workers test runtime because public record mutation is not implemented. They do not create identities in the public PLC Directory.

The four read routes use `withRepoReader` middleware after query validation. It creates one request-scoped `RepoReader` in `ctx.var.repoReader`; other XRPC routes do not initialize it. The service receives its dependencies through its constructor and does not read Worker configuration.

## D1

Create the production D1 database, then copy its ID into `wrangler.jsonc`:

```sh
pnpm --filter @minisphere/pds exec wrangler d1 create minisphere-pds
```

The PDS D1 schema is in `src/db/schema.ts`:

```sh
pnpm --filter @minisphere/pds db:generate add-account-column
pnpm --filter @minisphere/pds db:migrate:local
pnpm --filter @minisphere/pds db:migrate:remote
```

## Secrets

- `PDS_JWT_SECRET` — at least 32 random bytes used for account-session JWTs
- `PDS_ENCRYPTION_KEY` — stable secret of at least 32 random characters used to encrypt unclaimed repository private keys in D1; changing it makes existing reservations unreadable

Variables:

`src/config.ts` owns the PDS origin configuration schema. Zod validates origins before deriving defaults; they must be canonical HTTP(S) origins without credentials, paths, queries, fragments, or trailing slashes. The PDS schema has no handle-domain setting and ignores unrelated Worker bindings.

`resolveConfig()` reads the current `cloudflare:workers` environment on demand. `GET /health` validates configuration only: it does not check D1, repository Durable Objects, Accounts, or the PLC Directory. Invalid configuration returns a generic error response.

- `MINISPHERE_ORIGIN` — canonical Accounts origin; derives the PDS origin as `pds.<hostname>`
- `PLC_DIRECTORY` — optional PLC HTTP origin; omission selects `https://plc.directory`, while an explicit invalid origin fails validation

`MINISPHERE_ORIGIN` is required in every environment. Local development uses `MINISPHERE_ORIGIN=http://localhost:8790` with `PDS_ORIGIN=http://localhost:8787` to override the default subdomain layout.

Set `PLC_DIRECTORY` explicitly for private or local networks, and configure Accounts and Town with the same origin. Omitting it opts the PDS into the public PLC Directory. Account creation submits persistent public PLC records, so do not use the default for disposable development identities. A private selection and request failures never fall back to another directory.

Set production variables and secrets in the Worker's **Settings → Variables and Secrets**, and its custom domain in **Settings → Domains & Routes**. Deployments preserve these settings. Type generation reads `.dev.vars.example`, not private local values. See the [deployment guide](../../docs/DEPLOYMENT.md). Alternatively, set secrets with Wrangler:

```sh
pnpm --filter @minisphere/pds exec wrangler secret put PDS_JWT_SECRET
pnpm --filter @minisphere/pds exec wrangler secret put PDS_ENCRYPTION_KEY
```

## Development

Initialize local configuration and the stack from the repository root:

```sh
pnpm setup:local
```

Run the PDS with its Directory dependency or target its checks through Turbo:

```sh
pnpm dev:pds
pnpm turbo test typecheck build --filter=@minisphere/pds
```

The local PDS listens on `http://localhost:8787`. Its Directory dependency listens on port `8788`. The local `.dev.vars` file makes protected-resource metadata refer to this PDS and to Accounts on `http://localhost:8790`. Inspector ports remain dynamic so the Workers can run together.

Turbo regenerates PDS Worker types before type-checking when its configuration changes.
