# AT Protocol OAuth provider

`@minisphere/atproto-oauth-provider` is a Better Auth plugin that implements the AT Protocol OAuth authorization server on Cloudflare Workers. It uses Web Crypto and Better Auth's database adapter, not the Node-only `@atproto/oauth-provider`.

## Usage

`atprotoOAuthProvider(options)` takes callbacks for the parts each application owns:

- resolve the one active DID for a signed-in user, or send the user to account setup;
- build the login redirect and the consent-page URL;
- issue access tokens and return the public JWKS.

The consent page reads validated request details from `/oauth/authorization-details`. The DID is resolved on the server and checked again when consent is submitted.

## Supported profile

- Public clients only: HTTPS client metadata documents and the `http://localhost` development client.
- Required PAR, PKCE (S256), DPoP with server nonces, refresh-token rotation, and revocation.
- `prompt` may be omitted or `consent`. Silent authorization (`prompt=none`) is rejected.
- Access tokens last five minutes. The application's token callback must set `sub` to the DID, `aud` to the resource server, and `cnf.jkt` to the DPoP key thumbprint.
- `repo:` and `blob:` scopes are validated with `@atproto/oauth-scopes`. Each requested scope must appear in the client metadata. The resource server must enforce them.

Not supported: confidential clients (`private_key_jwt`), permission sets (`include:`), dynamic registration, client secrets, and implicit grants.

## Deployment requirements

- Use a database-backed Better Auth adapter. Single-use codes and replay protection need atomic storage shared by all Worker instances.
- On Cloudflare, enable the `global_fetch_strictly_public` compatibility flag. On other platforms, pass an equally restricted `clientMetadataFetch`.

The package is derived from the MIT-licensed Better Auth OAuth Provider plugin; see `LICENSE.better-auth`.

## Development

```sh
pnpm --filter @minisphere/atproto-oauth-provider test
pnpm --filter @minisphere/atproto-oauth-provider typecheck
```
