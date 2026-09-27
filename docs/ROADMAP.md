# Roadmap

Planned work, in priority order. Code, tests, and project READMEs describe what exists today; durable decisions belong in [ADRs](./adr/README.md). Remove an item when it ships.

## 1. Bluesky client compatibility

Password clients such as the Bluesky app sign in with [app passwords](./adr/0013-sign-in-password-clients-with-app-passwords.md), and the PDS proxies AppView and chat methods. Remaining:

- Video upload: `com.atproto.repo.uploadBlob` accepts the service-auth token the video service presents for the account.
- OAuth-authenticated `com.atproto.server.getSession`.
- Accounts OAuth support for `transition:generic`, `transition:chat.bsky`, `transition:email`, and `rpc:` permissions, enforced by the PDS.
- Permission sets (`include:`): Accounts resolves and validates the referenced Lexicons and obtains consent; the PDS enforces the resulting grants.

## 2. Identity and account lifecycle

- Handle changes from Accounts emit `#identity` events.
- Account activation, deactivation, deletion, status checks, and takedowns, each emitting `#account` events.
- Optional account migration in and out (`importRepo`, creating an account with an existing DID, PLC operation signing).

## 3. Operations and hardening

- Run a deployed end-to-end account-creation test through Accounts, PDS, PLC Directory, repository storage, and handle publication.
- Physical blob reclamation: temporary expiry, last-reference deletion, and orphan recovery across R2/SQLite failures and late uploads. Add cumulative storage quotas and upload rate limits before opening uploads more widely.
- Confidential `private_key_jwt` OAuth clients with signing-key continuity.
- A minimal first-party Relay.
