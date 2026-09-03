# Town

Town is a minimal AT Protocol OAuth client. It proves that a public browser client can complete the Minisphere Accounts authorization flow and display the active user's hosted handle.

## Flow

1. `@atcute/oauth-browser-client` discovers the authorization server from `PDS_ORIGIN`, creates the PAR request, PKCE verifier, and DPoP key, and stores the resulting OAuth session in the browser.
2. Accounts authenticates the user and obtains consent for the one active DID.
3. Town receives the authorization response at `/oauth/callback` and exchanges the code.
4. Atcute verifies the returned DID document and PDS through Town's PLC-backed API and the PDS handle resolver.
5. Town sends the verified DID to its Worker. The Worker reads the DID's `alsoKnownAs` claim through the private PLC Directory binding and returns the handle for display.

Town does not bind to Accounts, the PDS, D1, KV, or a Durable Object.

## Binding and variables

Binding:

- `DIRECTORY` — PLC Directory service used only to read the signed-in DID's handle claim.

Variables:

- `PDS_ORIGIN` — canonical public PDS origin used for OAuth protected-resource discovery.
- `PUBLIC_URL` — canonical public Town origin used by the OAuth Client ID Metadata Document and redirect URI.

`/oauth-client-metadata.json` is Town's public client metadata document. Town requests only the `atproto` scope.

## Development

```sh
cp apps/town/.env.example apps/town/.env
pnpm dev:town
pnpm turbo test typecheck build --filter=@minisphere/town
```

The Vite server uses `http://127.0.0.1:5174`. On loopback, Town uses the AT Protocol `http://localhost` development Client ID convention. A full local OAuth test also requires browser-reachable PDS and Accounts origins that advertise each other consistently.
