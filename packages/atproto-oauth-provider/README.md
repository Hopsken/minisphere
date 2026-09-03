# AT Protocol OAuth provider

`@minisphere/atproto-oauth-provider` is a Worker-compatible Better Auth plugin for the AT Protocol OAuth authorization-server profile. It uses Better Auth's session and adapter APIs, Web Crypto, and durable Better Auth verification records. It does not use the Node-focused `@atproto/oauth-provider` runtime.

The package exposes `atprotoOAuthProvider(options)`. Application callbacks resolve the one active DID subject for an authenticated Better Auth user, route incomplete users to account completion, provide the frontend authorization-page URL, create the login redirect, issue resource-server access tokens, and return the public JWKS advertised by authorization-server metadata. The frontend reads server-validated consent details from `/oauth/authorization-details` by using the opaque consent token. Consent stores the resolved DID server-side and resolves it again on submission; the browser never selects or submits a DID. The package does not import application code. Each consumer owns its authorization policy and storage behind those callbacks.

The package uses the runtime schemas from `@atcute/oauth-types` at protocol boundaries. These schemas validate client metadata, localhost client metadata, AT Protocol scopes, authorization-server metadata, PAR responses, and token responses. Server routing, durable state, replay protection, DPoP verification, and the stricter public-client security policy remain in this package because `@atcute/oauth-types` is not an authorization-server runtime.

## Current profile

The first milestone supports public clients only:

- HTTPS Client ID Metadata Documents and the `http://localhost` development client convention;
- mandatory PAR, state, S256 PKCE, authorization code, refresh token, DPoP, nonce, and revocation flows with query or fragment authorization responses;
- JSON and form-encoded PAR, token, and revocation requests;
- durable single-use and replay state through the Better Auth adapter;
- one server-resolved DID in the OAuth session and top-level token-response `sub`.

PAR requests expire after five minutes, authorization codes expire after one minute, and public-client sessions have a fixed maximum age of two weeks. Access tokens expire after five minutes. The application token callback must bind the resolved DID as `sub`, the resource origin as `aud`, and the DPoP JWK thumbprint as `cnf.jkt`.

All request URIs, authorization codes, refresh tokens, PKCE reservations, DPoP proof identifiers, and nonces use Better Auth verification records. A Worker deployment must configure a database-backed Better Auth adapter. In-memory adapters do not provide the required cross-isolate atomic guarantees.

Client metadata fetches reject redirects, local hostname forms, oversized bodies, and slow responses. Cloudflare deployments must enable the `global_fetch_strictly_public` compatibility flag so a malicious metadata hostname cannot route global `fetch()` to a same-zone Worker or private network. Other Worker platforms must supply an equivalently hardened `clientMetadataFetch` callback.

Confidential `private_key_jwt` clients are intentionally rejected and are not advertised. Dynamic registration, client secrets, OIDC client flows, client credentials, and implicit grants are not supported or advertised.

This public-only milestone is not the complete current AT Protocol OAuth profile. Confidential client authentication and client signing-key continuity remain deferred. They must be implemented together before `private_key_jwt` is added to authorization-server metadata.

The package was designed from the Better Auth OAuth Provider plugin's MIT-licensed source. The retained license is in `LICENSE.better-auth`.

## Development

```sh
pnpm --filter @minisphere/atproto-oauth-provider test
pnpm --filter @minisphere/atproto-oauth-provider typecheck
```
