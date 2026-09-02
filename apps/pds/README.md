# PDS

The PDS is a Hono Cloudflare Worker that exposes AT Protocol XRPC routes. It owns PDS account and session state and routes each DID to its repository Durable Object.

## Data ownership and bindings

- PDS D1 stores active account DIDs and refresh-token records. It does not store OIDC identities, usernames, or primary account passwords.
- PDS KV stores short-lived account invite codes and temporary repository signing-key reservations.
- [`@minisphere/repo-do`](../../packages/repo-do/README.md) owns repository data and repository signing keys.
- The private `DIRECTORY` service binding receives PLC genesis operations.
- `PdsControlPlane.generateInviteCode()` is a named RPC entrypoint for Accounts.
- `PdsControlPlane.fetch()` exposes the standard PDS XRPC routes to trusted service bindings.

Account creation accepts a syntactically valid handle and records it as an `alsoKnownAs` claim in the PLC genesis operation. `PDS_ORIGIN` is the canonical public HTTPS origin used for the DID document service endpoint and session JWT audience; these values do not depend on the incoming request URL. The PDS does not prove or publish the reverse handle-to-DID mapping. Accounts owns hosted handle mappings, and the stateless Handle Registry publishes the DID supplied by Accounts.

### Entryway provisioning

Entryway provisioning uses the standard AT Protocol methods:

1. `com.atproto.server.reserveSigningKey` generates a repository signing key. The PDS stores the private multikey temporarily and returns only its public `did:key`.
2. Accounts creates and signs the genesis PLC operation with its own rotation key and derives the expected `did:plc` before account creation.
3. Accounts gets a one-time invite through `PdsControlPlane.generateInviteCode()`. `com.atproto.server.createAccount` receives that invite, DID, handle, and PLC operation. The PDS verifies the invite, DID derivation, operation signature, PDS endpoint, handle claim, and reserved repository key.
4. The PDS reserves the DID-named repository, submits the PLC operation, and records the local account. Accounts independently verifies PDS repository and PLC state before activation.

The PDS does not allocate or enforce hosted-handle uniqueness. Accounts owns that policy. A retry after an unknown response uses the same pre-derived DID and signed PLC operation. Repository reservation and PLC submission tolerate already-completed side effects, while Accounts checks `com.atproto.sync.getRepoStatus` and resolved PLC state before sending another create request.

## OAuth resource contract

`/.well-known/oauth-protected-resource` identifies `PDS_ORIGIN` as the resource and `ACCOUNTS_ORIGIN` as its authorization server. Accounts signs maximum-five-minute ES256K access JWTs and advertises its `jwks_uri` through authorization-server metadata. The PDS discovers the JWT `kid` from that JWKS and verifies these claims:

- selected DID in `sub`;
- PDS origin in `aud`;
- Accounts origin in `iss`;
- current authorization scope in `scope`;
- OAuth client ID in `client_id`;
- DPoP JWK thumbprint in `cnf.jkt`.

Accounts revocation stops refresh and new token issuance. An already issued access JWT can remain valid until its five-minute expiry. On protected resource requests, the PDS must also confirm that `sub` is a local active account; token signature verification alone is not account authorization.

PDS XRPC routes do not yet accept these OAuth tokens or enforce repository permissions. Resource-request DPoP verification, including `ath`, and scope enforcement are the next PDS milestone. That work must use `@atproto/oauth-scopes` for AT Protocol permission checks; OAuth client scope builders do not enforce permissions.

## D1 and KV

Create the production D1 database and KV namespace, then copy their IDs into `wrangler.jsonc`:

```sh
pnpm --filter @minisphere/pds exec wrangler d1 create minisphere-pds
pnpm --filter @minisphere/pds exec wrangler kv namespace create minisphere-pds-kv
```

The account schema is in `src/db/schema.ts`:

```sh
pnpm --filter @minisphere/pds db:generate add-account-column
pnpm --filter @minisphere/pds db:migrate:local
pnpm --filter @minisphere/pds db:migrate:remote
```

## Secrets

- `PDS_JWT_SECRET` — at least 32 random bytes used for account-session JWTs
- `PDS_ROTATION_KEY` — stable secp256k1 private multikey used to sign PLC operations for standalone invite-based account creation

Variables:

- `ACCOUNTS_ORIGIN` — canonical Accounts OAuth issuer origin
- `PDS_ORIGIN` — canonical OAuth resource and PDS service origin

```sh
pnpm --filter @minisphere/pds exec wrangler secret put PDS_JWT_SECRET
pnpm --filter @minisphere/pds exec wrangler secret put PDS_ROTATION_KEY
```

## Development

Create local secrets once and initialize the local stack from the repository root:

```sh
cp apps/pds/.dev.vars.example apps/pds/.dev.vars
pnpm setup:local
```

Run the PDS with its Directory dependency or target its checks through Turbo:

```sh
pnpm dev:pds
pnpm turbo test typecheck build --filter=@minisphere/pds
```

The local PDS listens on port `8787`. Its Directory dependency listens on port `8788`. Inspector ports remain dynamic so both Workers can run together.

Turbo regenerates PDS Worker types before type-checking when its Wrangler configuration or Directory dependency changes.
