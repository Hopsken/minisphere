# 0014. Store actor preferences on the PDS

## Status

Proposed

## Context

Bluesky clients read and write preferences with `app.bsky.actor.getPreferences` and `putPreferences` on the account's PDS. The Bluesky app reads them every time it starts. In the Bluesky network, the entryway does not store preferences; each PDS does.

Accounts owns people and their credentials; the PDS owns the state of the accounts it hosts ([ADR 0002](./0002-assign-each-fact-to-one-owning-service.md)). Preferences, such as saved feeds, muted words, and moderation settings, describe how the hosted account uses an app.

The birth date is also a preference in the protocol: `personalDetailsPref`. Clients use the age derived from it, `declaredAgePref`, to choose which content and features to offer. Only full-access sessions may read or write `personalDetailsPref`, and no Minisphere session has full access ([ADR 0013](./0013-sign-in-password-clients-with-app-passwords.md)).

## Decision

- The PDS owns the `app.bsky` preferences of the accounts it hosts, including the birth date. It stores them per account in its D1 database and deletes them with the account.
- Preferences are private account state, not repository data. They do not go into `RepoDO`, the firehose, or repository exports.
- The PDS serves both methods without calling Accounts. A request with `atproto-proxy` for another AppView is proxied.
- The PDS rejects `personalDetailsPref` from clients and never returns it. `getPreferences` returns a `declaredAgePref` derived from the birth date when it is read. The PDS does not store the derived age.
- The user sets the birth date on the Accounts Settings page. Accounts reads and writes it through the `PdsControlPlane` service binding and does not store it.

## Consequences

- Reading preferences does not depend on Accounts, so app startup takes no extra round trip between services.
- Service calls go in one direction only, from Accounts to the PDS.
- Preferences move with the hosting. Account migration copies them with `getPreferences` and `putPreferences`, as between any two PDSes. The birth date needs full access and does not move this way.
- Clients cannot set the birth date. A user who has none must set it in Accounts.
- The derived age stays correct as the user ages.
- Each account's list is bounded by the one-megabyte request limit on `putPreferences`.

## References

- [PDS README: Preferences](../../apps/pds/README.md#preferences)
- [Accounts README: Birth date](../../apps/accounts/README.md#birth-date)
- [ADR 0002](./0002-assign-each-fact-to-one-owning-service.md)
- [ADR 0013](./0013-sign-in-password-clients-with-app-passwords.md)
