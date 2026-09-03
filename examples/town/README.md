# Town

Town is a minimal AT Protocol OAuth client. It proves that a public browser client can complete the Minisphere Accounts authorization flow and display the active user's hosted handle.

## Flow

1. The user enters a handle. `@atcute/oauth-browser-client` asks Town's same-origin XRPC endpoint for its DID.
2. Town's Worker uses standard DNS and HTTPS handle resolution. Handles under `.test` use the configured local XRPC adapter.
3. Atcute resolves the DID document through Town's PLC-backed API and reads the user's PDS service endpoint.
4. Atcute discovers the PDS OAuth protected-resource metadata and its authorization server, then creates the PAR request, PKCE verifier, and DPoP key.
5. Accounts authenticates the user and obtains consent for the resolved DID.
6. Town receives the authorization response at `/oauth/callback`, exchanges the code, verifies the returned identity, and displays the handle from the selected PLC Directory.

Town runs as an external client with a Worker, static assets, and configuration variables. It reaches AT Protocol services through HTTP discovery.

## Variables

- `PUBLIC_URL` — canonical Town origin used by the OAuth Client ID Metadata Document and redirect URI.
- `PLC_DIRECTORY_ORIGIN` — selected `did:plc` directory. The DID document selects the PDS, and PDS metadata selects the authorization server.
- `DEV_HANDLE_RESOLVER_ORIGIN` — optional local XRPC transport for `.test` handles.

`/oauth-client-metadata.json` is Town's public client metadata document. Town requests the `atproto` scope. The Worker exposes same-origin handle resolution and PLC reads to the browser.

## Development

```sh
pnpm setup:local
pnpm dev:town:local
pnpm turbo test typecheck build --filter=@minisphere/town
```

The Vite server uses `http://127.0.0.1:5174`. On loopback, Town uses the AT Protocol `http://localhost` development Client ID convention. The default local variables select PLC Directory port `8788` and Handle Registry port `8789`; discovery then reaches PDS port `8787` and Accounts port `8790`.

Use `pnpm dev:town` to run Town independently. Set `PLC_DIRECTORY_ORIGIN=https://plc.directory` in Town's `.dev.vars` to verify public handles and infrastructure.
