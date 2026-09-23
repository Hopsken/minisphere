# Town

Town is a minimal AT Protocol OAuth browser client for an existing account, including a public Bluesky account. It creates plain-text posts on that account's PDS. It does not need Minisphere Accounts or Minisphere PDS write APIs.

The planned production origin is `https://town.r2d2.party`. Accounts reserves the username `town` to keep that application hostname separate from user handles. Configure `PUBLIC_URL` and the custom domain when deploying; this reservation does not configure DNS or deploy Town.

The reservation change is separate Accounts work; this Town implementation does not mean it has been released.

## Flow

1. The user enters a handle, DID, or HTTPS PDS URL. For a handle, `@atcute/oauth-browser-client` asks Town's same-origin XRPC endpoint for its DID.
2. Town's Worker uses standard DNS and HTTPS handle resolution. Handles under `.test` use the configured local XRPC adapter.
3. Atcute resolves `did:plc` through Town's PLC-backed API, or `did:web` with its standard resolver, and reads the user's PDS service endpoint.
4. Atcute discovers the PDS OAuth protected-resource metadata and its authorization server, then creates the PAR request, PKCE verifier, and DPoP key.
5. The discovered authorization server authenticates the user and obtains consent. Town never receives a password.
6. Town receives the authorization response at `/oauth/callback`, exchanges the code, and verifies the identity. The browser uses `@atcute/client` with `OAuthUserAgent` to write directly to the discovered PDS. The library handles DPoP, nonce challenges, and refresh.
7. Public `describeRepo`, profile `getRecord`, post `getRecord`, and `listRecords` calls go directly to that same PDS without credentials. No AppView or Town backend relay is used.

Town runs as an external client with a Worker, static assets, and configuration variables. It reaches AT Protocol services through HTTP discovery.

## Variables

- `PUBLIC_URL` — canonical Town origin used by the OAuth Client ID Metadata Document and redirect URI.
- `PLC_DIRECTORY` — optional selected `did:plc` directory; defaults to `https://plc.directory` only when omitted. Invalid explicit values fail. A request failure never falls back to another directory. The DID document selects the PDS, and PDS metadata selects the authorization server.
- `DEV_HANDLE_RESOLVER_ORIGIN` — optional local XRPC transport for `.test` handles.

Set production `PUBLIC_URL` and, if needed, `PLC_DIRECTORY` in the Worker's **Settings → Variables and Secrets**, and its custom domain in **Settings → Domains & Routes**. Do not set the development resolver in production. Deployments preserve these settings. Type generation reads `.dev.vars.example`, not private local values. See the [deployment guide](../../docs/DEPLOYMENT.md).

`/oauth-client-metadata.json` is Town's public client metadata document. Metadata, authorization requests, and the loopback Client ID use `atproto repo?collection=app.bsky.feed.post&action=create`, as defined by the [AT Protocol permission specification](https://atproto.com/specs/permission). There are no update, delete, blob, or AppView RPC permissions. An older `atproto`-only session must use **Authorize posting** to get fresh consent; refresh does not upgrade its scope.

## Posts and recovery

The composer uses `AppBskyFeedPost.Main` and `AppBskyFeedPost.mainSchema` from `@atcute/bluesky`. It sends only `$type`, `text`, and `createdAt`. The limit is 300 Unicode graphemes and 3,000 UTF-8 bytes; whitespace-only posts are rejected. There are no attachments, facets, replies, quotes, updates, deletes, or timeline controls.

Drafts and a pending operation are stored in browser local storage, keyed by DID. They are not stored by Town's Worker. The pending operation contains the record, a TID record key, and whether the PDS confirmed creation. It is saved before the write; if storage is unavailable, Town does not start a write that it cannot recover. Do not clear site data while a result is uncertain.

- A successful write is read back with `getRecord` before the post is displayed. Confirmed writes clear the composer even if readback fails. **Retry reading** never sends another write.
- After a failed or timed-out write, Town checks the same key. If found with the expected text and timestamp, it displays the record. If absent, the user can retry the same record/key. If reading fails, Town keeps the draft and only offers a check. It never silently creates a new key for an uncertain write.
- A reload retains a pending operation. The most recent 10 posts are loaded with `listRecords`, `reverse=true`, and `limit=10`, in descending repository-key order rather than sorted by user-supplied timestamps. After a post is read back, Town shows it immediately and refreshes the list. A failed list refresh keeps the visible posts and offers a read-only retry.
- Duplicate clicks are blocked while an operation is active. Pending writes must be resolved before composing another post.

## Development

```sh
pnpm setup:local
pnpm dev:town:local
pnpm turbo test typecheck build --filter=@minisphere/town
```

The Vite server uses `http://127.0.0.1:5174`. On loopback, Town uses the AT Protocol `http://localhost` development Client ID convention. The default local variables select PLC Directory port `8788` and Accounts as the development handle resolver on port `8790`; discovery then reaches PDS port `8787`.

Setup preserves an existing `.dev.vars`. If it still has `DEV_HANDLE_RESOLVER_ORIGIN=http://localhost:8789`, manually change it to `http://localhost:8790`; the former Handle Registry no longer exists.

Use `pnpm dev:town` to run Town independently. Set `PLC_DIRECTORY=https://plc.directory` in Town's `.dev.vars` to verify public handles and infrastructure.

For public-account testing, do not use the private directory copied by `setup:local`: explicitly select `https://plc.directory` (or remove `PLC_DIRECTORY`) and remove `DEV_HANDLE_RESOLVER_ORIGIN`. The local template deliberately keeps the private directory. Open the local Vite server on the machine running the browser to use the loopback Client ID.

## Orb preview and real OAuth

Build from the repository root, then run a supervised preview with explicit public-directory configuration:

```sh
pnpm turbo test typecheck build --filter=@minisphere/town
amp orb service start town --cwd "$PWD/examples/town" --port 5174 \
  --command 'pnpm exec wrangler dev --config dist/minisphere_town/wrangler.json --port "$PORT" --var "PUBLIC_URL:$PUBLIC_URL" --var PLC_DIRECTORY:https://plc.directory' \
  --portal --title Town
```

Use the exact portal URL printed by Amp. `PUBLIC_URL` is supplied by the supervisor, not inferred from request headers. The runtime overrides keep client metadata and the callback on the portal origin and keep PLC reads on the public directory, even if local private variables exist. Rebuild and run `amp orb service restart town` after code changes.

**Amp portals are private by default.** External authorization servers need unauthenticated access to `/oauth-client-metadata.json`. The owner must open **Portal Options → Make Public** and choose a short duration before trying real OAuth. Making a portal public changes access and needs the owner's approval. Requests inside the orb bypass the portal access gate, so an internal `curl` cannot prove external metadata access. A normal public HTTPS deployment is an alternative, but requires separate approval and domain configuration.

The user signs in on their provider's page, confirms create-post permission, returns to Town, and manually posts a short test message. Reload Town to verify that the PDS record is still visible. Never supply a password or token to an agent. Mock UI checks establish layout and recovery behavior only; they do not establish real OAuth success.
