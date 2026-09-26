# 0005. Make Accounts the OAuth authorization server

## Status

Accepted

## Context

Accounts already authenticates users and knows each user's DID. The PDS hosts the repositories that clients write to. AT Protocol OAuth separates the authorization server from the resource server, and clients discover the authorization server through the PDS metadata.

## Decision

- Accounts is the authorization server. It owns consent, refresh state, and access-token signing.
- The PDS is the resource server. Its protected-resource metadata names Accounts.
- The PDS discovers the Accounts JWKS through the Accounts metadata over public HTTP. It accepts a token only after it verifies the signature, issuer, audience, lifetime, scope, DPoP binding, and that the subject is hosted locally.
- Primary authentication never uses a PDS password. App passwords, if added, are a separate capability.

## Consequences

- Accounts can rotate signing keys without changes to the PDS, if it keeps retired public keys in the JWKS.
- The PDS depends on Accounts metadata being reachable. A revoked session keeps issued access tokens valid until they expire (at most five minutes).
- Legacy PDS session tokens do not authorize writes.

## References

- [`packages/atproto-oauth-provider`](../../packages/atproto-oauth-provider/README.md)
- [PDS README: Authentication](../../apps/pds/README.md#authentication)
