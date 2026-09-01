# PDS

The PDS is a Hono Cloudflare Worker that exposes AT Protocol XRPC routes. It owns PDS account and session state and routes each DID to its repository Durable Object.

## Data ownership and bindings

- PDS D1 stores account DIDs and refresh-token records. It does not store handles or primary account passwords.
- PDS KV stores short-lived account invite codes.
- [`@minisphere/repo-do`](../../packages/repo-do/README.md) owns repository data and repository signing keys.
- The private `DIRECTORY` service binding receives PLC genesis operations.
- `PdsControlPlane.generateInviteCode()` is a named RPC entrypoint for Accounts.
- `PdsControlPlane.issueOAuthAccessToken()` issues short-lived, DPoP-bound OAuth access JWTs for Accounts.

Account creation accepts a syntactically valid handle and records it as an `alsoKnownAs` claim in the PLC genesis operation. `PDS_ORIGIN` is the canonical public HTTPS origin used for the DID document service endpoint and session JWT audience; these values do not depend on the incoming request URL. The PDS does not prove or publish the reverse handle-to-DID mapping. Accounts owns managed handle mappings, and the stateless Handle Registry publishes the DID supplied by Accounts.

## OAuth resource contract

`/.well-known/oauth-protected-resource` identifies `PDS_ORIGIN` as the resource and `ACCOUNTS_ORIGIN` as its authorization server. The private token RPC accepts only those configured issuer and audience values and creates an HS256 access JWT with a maximum five-minute lifetime. Its claims include:

- selected DID in `sub`;
- PDS origin in `aud`;
- Accounts origin in `iss`;
- current authorization scope in `scope`;
- OAuth client ID in `client_id`;
- DPoP JWK thumbprint in `cnf.jkt`.

Accounts revocation stops refresh and new token issuance. An already issued access JWT can remain valid until its five-minute expiry.

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
- `PDS_ROTATION_KEY` — secp256k1 private multikey used to sign PLC operations

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
