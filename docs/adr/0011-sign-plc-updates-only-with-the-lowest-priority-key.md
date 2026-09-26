# 0011. Sign PLC updates only with the lowest-priority key

## Status

Accepted

## Context

Users can correct the PDS endpoint in their DID document through Accounts, which signs with its managed rotation key. PLC has no compare-and-swap submission. During the 72-hour recovery window, a higher-priority rotation key can replace operations signed by a lower-priority key. If the Accounts key had high priority, a submission race could turn a normal update into an unintended recovery that erases another writer's change.

## Decision

- Accounts signs a change only when its managed key is the last (lowest-priority) rotation key in the current head. Otherwise it returns `409`. It never reorders keys to get around this.
- The client must send the head it read (`expectedHead`). Accounts checks it again just before it submits.
- After each submission attempt, Accounts reads the directory again and reports success only if its operation is the head. It never resubmits automatically.
- Only the PDS endpoint can change. Rotation keys cannot be edited through Accounts.

## Consequences

- An Accounts update cannot overwrite a competing operation, with no lock or lease.
- Holders of higher-priority keys can still recover over an Accounts update. Success means the update was the head when Accounts verified it, not that it is final.
- Users who reorder keys with other tools lose self-service updates.

## References

- [DID PLC specification](https://web.plc.directory/spec/v0.1/did-plc)
- [Accounts README: PLC endpoint correction](../../apps/accounts/README.md#plc-endpoint-correction)
