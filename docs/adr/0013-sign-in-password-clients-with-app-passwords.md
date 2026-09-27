# 0013. Sign in password clients with app passwords

## Status

Proposed

## Context

The Bluesky app and many other clients sign in only with `com.atproto.server.createSession`: a handle and a password sent to the account's PDS. They do not support OAuth. Minisphere users have no password; they sign in to Accounts with email codes ([ADR 0005](./0005-make-accounts-the-oauth-authorization-server.md) keeps it that way). Clients find the PDS from the DID document, so the password reaches the PDS, not Accounts.

## Decision

- Accounts owns app passwords. A signed-in user creates, lists, and revokes them in Accounts. Accounts stores only a SHA-256 hash of each generated 80-bit secret and shows the secret once. An app password can be privileged, which allows direct messages.
- Accounts serves `com.atproto.server.createSession`, `refreshSession`, `getSession`, and `deleteSession`. The PDS forwards these four methods to Accounts unchanged, so a client can sign in through either host.
- Accounts signs the session tokens with its current OAuth signing key. The access token is a Bearer token with `typ: at+jwt`, audience `did:web:<PDS host>`, scope `com.atproto.appPass` or `com.atproto.appPassPrivileged`, and a lifetime of at most five minutes. The refresh token has `typ: refresh+jwt` and is verified only by Accounts.
- Refresh tokens rotate on use. A rotated token keeps returning the same successor for two hours, so a client that lost a response can retry. Logging out deletes the token; revoking an app password deletes all its tokens.
- The PDS accepts a Bearer access token after the same JWKS, issuer, audience, lifetime, and hosted-account checks as an OAuth token. It grants the permissions of `transition:generic`, plus `transition:chat.bsky` for privileged app passwords.

## Consequences

- Password clients work without giving Minisphere a primary account password.
- The PDS remains stateless for sessions. Revocation takes effect for access tokens only when they expire, within five minutes.
- One signing key serves two token formats. The verifiers keep them apart by `typ`, audience, and claims: OAuth tokens are DPoP-bound and name a client; session tokens are neither.
- App-password sessions never get full account access. Account-management methods that require it are unavailable to them.

## References

- [Accounts README: App passwords](../../apps/accounts/README.md#app-passwords)
- [PDS README: Authentication](../../apps/pds/README.md#authentication)
- [ADR 0005](./0005-make-accounts-the-oauth-authorization-server.md)
