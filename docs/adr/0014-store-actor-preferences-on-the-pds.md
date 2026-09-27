# 0014. Store actor preferences on the PDS

## Status

Proposed

## Context

Bluesky clients read and write preferences with `app.bsky.actor.getPreferences` and `putPreferences` on the account's PDS. The Bluesky app reads them every time it starts. In the Bluesky network, the entryway does not store preferences; each PDS does.

Accounts owns people and their credentials; the PDS owns the state of the accounts it hosts ([ADR 0002](./0002-assign-each-fact-to-one-owning-service.md)). Most preferences, such as saved feeds, muted words, and moderation settings, describe how the hosted account uses an app. `personalDetailsPref` is different. It holds a birth date, which is a fact about the person. The protocol exposes it only to full-access sessions, and no Minisphere session has full access ([ADR 0013](./0013-sign-in-password-clients-with-app-passwords.md)).

## Decision

- The PDS owns the `app.bsky` preferences of the accounts it hosts. It stores one list per account in its D1 database and deletes it with the account.
- Preferences are private account state, not repository data. They do not go into `RepoDO`, the firehose, or repository exports.
- The PDS serves both methods without calling Accounts. A request with `atproto-proxy` for another AppView is proxied.
- The PDS rejects `personalDetailsPref`. It does not store `declaredAgePref`, which is derived from the birth date.
- If Minisphere supports birth dates, Accounts will own the birth date as a fact about the user. The PDS will read it from Accounts and derive `declaredAgePref`. That change needs a new ADR.

## Consequences

- Reading preferences does not depend on Accounts, so app startup takes no extra round trip between services.
- Preferences move with the hosting. Account migration copies them with `getPreferences` and `putPreferences`, as between any two PDSes.
- Clients get no birth date. The Bluesky app may ask for one, and saving it fails.
- Each account's list is bounded by the one-megabyte request limit on `putPreferences`.

## References

- [PDS README: Preferences](../../apps/pds/README.md#preferences)
- [ADR 0002](./0002-assign-each-fact-to-one-owning-service.md)
- [ADR 0013](./0013-sign-in-password-clients-with-app-passwords.md)
