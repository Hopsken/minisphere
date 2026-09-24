# Town

Town is a minimal AT Protocol OAuth browser client. It signs in to any existing account, including a public Bluesky account, then creates plain-text posts and edits the profile directly on that account's PDS. It uses only standard AT Protocol APIs.

## Flow

1. The user enters a handle, DID, or PDS URL.
2. Town's Worker resolves the handle with standard DNS and HTTPS resolution. `.test` handles go to `DEV_HANDLE_RESOLVER_ORIGIN`.
3. `@atcute/oauth-browser-client` reads the DID document, finds the PDS and its authorization server, and runs the OAuth flow. Town never sees a password.
4. The browser writes to the PDS with `@atcute/client`. Public reads go to the same PDS. Town has no backend database.

Town requests `atproto`, post creation, profile create and update, and PNG/JPEG upload permissions. The scope is defined in [`worker/configuration.ts`](./worker/configuration.ts).

**Log out** revokes the token when possible and always removes the local OAuth session.

## Posts

Posts contain text only, up to 300 graphemes and 3,000 bytes.

Town never creates a duplicate post after an uncertain result:

- Before each write, it saves the draft and a fixed record key in local storage.
- A successful write is read back before it is shown. If the read fails, Town offers **Retry reading**, which never writes again.
- After a failed or timed-out write, Town checks the same record key. It shows the record if it exists, and offers to retry the same record only if the record is missing.

Do not clear site data while a result is uncertain. The feed shows the 10 newest posts.

## Profile

Select the profile row in the account menu to edit the display name, description, and avatar (JPEG or PNG, up to 1,000,000 bytes). Saving uses `swapRecord`, so an edit made elsewhere in the meantime causes a conflict instead of being overwritten. After a failed save, reload the profile before you save again.

## Configuration

- `PUBLIC_URL` — the canonical Town origin, used for the OAuth client metadata and redirect URI.
- `PLC_DIRECTORY` — optional; defaults to `https://plc.directory`.
- `DEV_HANDLE_RESOLVER_ORIGIN` — local development only. Do not set it in production.

Keep the `global_fetch_strictly_public` compatibility flag enabled so that handle resolution can reach Accounts routes in the same Cloudflare zone.

## Development

```sh
pnpm setup:local
pnpm dev:town:local
pnpm turbo test typecheck build --filter=@minisphere/town
```

Town runs at `http://127.0.0.1:5174` and uses the `http://localhost` development client ID. The local template uses the local Directory and Accounts.

To test a public account, set `PLC_DIRECTORY=https://plc.directory` and remove `DEV_HANDLE_RESOLVER_ORIGIN` in `.dev.vars`.

## Real OAuth from an orb

External authorization servers must fetch Town's client metadata, so Town needs a public URL. Build Town, then run it as a portal service:

```sh
pnpm turbo build --filter=@minisphere/town
amp orb service start town --cwd "$PWD/examples/town" --port 5174 \
  --command 'pnpm exec wrangler dev --config dist/minisphere_town/wrangler.json --port "$PORT" --var "PUBLIC_URL:$PUBLIC_URL" --var PLC_DIRECTORY:https://plc.directory' \
  --portal --title Town
```

Portals are private by default. The owner must select **Portal Options → Make Public** for a short time before signing in. A `curl` from inside the orb cannot confirm external access. The owner signs in, posts, and reloads to confirm the post; never give a password or token to an agent.
