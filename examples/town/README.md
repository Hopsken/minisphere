# Town

Town is a minimal AT Protocol OAuth client. It proves that a public browser client can complete the Minisphere Accounts authorization flow and display the active user's hosted handle.

## Flow

1. The user enters a handle. `@atcute/oauth-browser-client` asks the configured XRPC handle resolver for its DID.
2. Atcute resolves the DID document through Town's PLC-backed API and reads the user's PDS service endpoint.
3. Atcute discovers the PDS OAuth protected-resource metadata and its authorization server, then creates the PAR request, PKCE verifier, and DPoP key.
4. Accounts authenticates the user and obtains consent for the resolved DID.
5. Town receives the authorization response at `/oauth/callback`, exchanges the code, and verifies the returned identity again.
6. Town sends the verified DID to its Worker. The Worker reads the DID's `alsoKnownAs` claim through the private PLC Directory binding and returns the handle for display.

Town does not bind to Accounts, the PDS, D1, KV, or a Durable Object.

## Binding and variables

Binding:

- `DIRECTORY` — PLC Directory service used only to read the signed-in DID's handle claim.

Variables:

- `HANDLE_RESOLVER_ORIGIN` — XRPC service used only for the initial handle-to-DID lookup. The resolved DID document selects the PDS used for OAuth.
- `PUBLIC_URL` — canonical public Town origin used by the OAuth Client ID Metadata Document and redirect URI.

`/oauth-client-metadata.json` is Town's public client metadata document. Town requests only the `atproto` scope.

## Development

```sh
cp examples/town/.env.example examples/town/.env
cp examples/town/.dev.vars.example examples/town/.dev.vars
pnpm setup:local
pnpm dev
pnpm turbo test typecheck build --filter=@minisphere/town
```

The Vite server uses `http://127.0.0.1:5174`. On loopback, Town uses the AT Protocol `http://localhost` development Client ID convention. The local variables point handle resolution to the Handle Registry on port `8789`; the resolved PLC document then points OAuth to the PDS on port `8787` and Accounts on port `5173`.
