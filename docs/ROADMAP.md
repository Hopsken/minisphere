# Roadmap

Planned work, in priority order. Code, tests, and project READMEs describe what exists today; durable decisions belong in [ADRs](./adr/README.md). Remove an item when it ships.

## 1. Relay synchronization

Relays must be able to crawl the PDS before any AppView can index its accounts.

- `com.atproto.sync.subscribeRepos`: a sequenced, cursor-replayable event stream with `#commit`, `#sync`, `#identity`, `#account`, and `#info` messages.
- `com.atproto.sync.listRepos` and `com.atproto.sync.getBlocks`.
- Verify against a local relay, then announce the PDS to public relays with `com.atproto.sync.requestCrawl`.

## 2. Bluesky client compatibility

- `com.atproto.server.describeServer` and OAuth-authenticated `com.atproto.server.getSession`.
- Service proxying for `atproto-proxy` and default `app.bsky.*` / `chat.bsky.*` AppView routing, with inter-service JWTs signed by the repository key and `com.atproto.server.getServiceAuth`.
- PDS-owned `app.bsky.actor.getPreferences` and `putPreferences`.
- Accounts OAuth support for `transition:generic`, `transition:chat.bsky`, `transition:email`, and `rpc:` permissions, enforced by the PDS.
- Permission sets (`include:`): Accounts resolves and validates the referenced Lexicons and obtains consent; the PDS enforces the resulting grants.

## 3. Identity and account lifecycle

- Handle changes from Accounts emit `#identity` events.
- Account activation, deactivation, deletion, status checks, and takedowns, each emitting `#account` events.
- Optional account migration in and out (`importRepo`, creating an account with an existing DID, PLC operation signing).

## 4. Operations and hardening

- Run a deployed end-to-end account-creation test through Accounts, PDS, PLC Directory, repository storage, and handle publication.
- Physical blob reclamation: temporary expiry, last-reference deletion, and orphan recovery across R2/SQLite failures and late uploads. Add cumulative storage quotas and upload rate limits before opening uploads more widely.
- Confidential `private_key_jwt` OAuth clients with signing-key continuity.
- A minimal first-party Relay.
