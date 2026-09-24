# Accounts

Accounts is the Entryway: it signs users in, gives each user one AT Protocol account on the paired PDS, publishes hosted handles, and runs the AT Protocol OAuth authorization server. It is a React SPA and a Hono Cloudflare Worker with Better Auth and D1.

Accounts owns users, usernames, hosted handle-to-DID mappings, and each account's PLC rotation key. See [ADR 0002](../../docs/adr/0002-assign-each-fact-to-one-owning-service.md) for the ownership boundaries.

## Email login

One email-code flow handles both registration and login. A user is created only after a successful verification.

- Codes have six digits, expire after ten minutes, and allow five attempts. Only the latest code works.
- A new code can be requested once every 60 seconds per email. Each IP is also rate-limited.
- `EMAIL_ALLOWLIST` is a comma-separated list: `*` allows all, `x.com` allows that exact domain (not subdomains), and `e@e.com` allows that address. Matching ignores case and surrounding spaces. An empty list denies everyone. Changing the list does not end existing sessions.

Passwords, email changes, and account recovery are not implemented.

## Accounts and handles

Each user has at most one account. The username is permanent, and the hosted handle is `<username>.<handle domain>`.

- `GET /api/account` returns the account state: `needs_username`, `provisioning`, or `active`.
- `POST /api/account` with `{ "username": "..." }` reserves the username and creates the identity. It returns `201` when active and `202` while provisioning. Repeat the same request to retry; it reuses the same DID.
- `GET /api/account/usernames/:username` reports availability. Reserved names look the same as taken names.

Hosted handles resolve without login, and only for active accounts:

- `GET /.well-known/atproto-did` resolves the request hostname.
- `GET /xrpc/com.atproto.identity.resolveHandle?handle=...` resolves the parameter. This route allows CORS.

## PLC endpoint correction

An active user can read and correct the PDS endpoint in their own DID document. The Settings page shows a mismatch with the configured PDS and offers a fix.

- `GET /api/account/plc` returns the current PLC data, its `head` CID, and `expectedPdsEndpoint` from configuration.
- `PATCH /api/account/plc` accepts exactly `{ "expectedHead", "pdsEndpoint" }`. The endpoint must be an HTTPS origin. The response adds `changed`.

Writes require an `Origin` header equal to `MINISPHERE_ORIGIN`. A stale `expectedHead` returns `409`. Accounts signs a change only when its managed key is the lowest-priority rotation key; otherwise the result is `409`. After a timeout, `503` or `502` means the outcome is unknown: read again before you retry. Only the PDS endpoint changes. Rotation keys cannot be edited, and changing the endpoint does not migrate a repository.

## AT Protocol OAuth

[`@minisphere/atproto-oauth-provider`](../../packages/atproto-oauth-provider/README.md) serves `/.well-known/oauth-authorization-server` and the `/oauth/*` routes.

- Only public clients are supported: HTTPS client metadata documents and the `http://localhost` development client.
- The user must have an active account. Consent binds that account's DID; the browser cannot choose another DID.
- Accepted scopes are `atproto`, `repo:` permissions for any collection, and `blob:` upload permissions. Every requested scope must appear in the client metadata. Refresh never expands a grant.
- Access tokens last five minutes and are bound to the client's DPoP key. The PDS verifies them with the public JWKS advertised in the metadata.

Keep the `global_fetch_strictly_public` compatibility flag enabled. It stops client-metadata fetches from reaching private networks or Workers in the same zone.

## Configuration

Bindings:

- `DB` — the Accounts D1 database.
- `PDS` — the PDS `PdsControlPlane` entrypoint.

Variables:

- `MINISPHERE_ORIGIN` — required. The Accounts origin; the PDS origin is `pds.<hostname>` and the handle domain is the hostname.
- `EMAIL_ALLOWLIST` — see [Email login](#email-login).
- `EMAIL_FROM` — a sender on a domain verified in Resend.
- `PLC_DIRECTORY` — optional; defaults to `https://plc.directory`. Use the same value in Accounts, the PDS, and Town.
- `PDS_ORIGIN`, `PUBLIC_HANDLE_DOMAIN` — optional overrides, used locally.

Secrets:

- `BETTER_AUTH_SECRET` — at least 32 random characters.
- `RESEND_API_KEY` — a Resend key that can send email.
- `ACCOUNTS_ENCRYPTION_KEY` — at least 32 random characters, independent of `BETTER_AUTH_SECRET`. It encrypts private keys in D1. **If you lose or change it, the stored keys become unreadable.** Back it up separately from D1.

Set production values in the Cloudflare Dashboard. See the [deployment guide](../../docs/DEPLOYMENT.md).

## Development

```sh
pnpm setup:local
pnpm dev:accounts
pnpm turbo test typecheck build --filter=@minisphere/accounts
```

The development server runs at `http://localhost:8790`. To sign in a test browser, open `/__dev/log-me-in/<email>?returnTo=<path>`. This route exists only in Vite development.

For an Amp orb preview, run:

```sh
amp orb service start accounts --command 'pnpm --filter @minisphere/accounts dev' --port 8790 --portal
```

### Database changes

`worker/lib/better-auth/options.ts` holds the Better Auth options. After you change them, regenerate the Better Auth schema, then create and apply a named migration:

```sh
pnpm --filter @minisphere/accounts auth:generate
pnpm --filter @minisphere/accounts db:generate add-auth-field
pnpm --filter @minisphere/accounts db:migrate:local
```

Do not edit `worker/db/schema/better-auth.ts` by hand.
