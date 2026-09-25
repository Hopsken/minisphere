# 0012. Sequence repository events in one Durable Object

## Status

Proposed

## Context

Relays consume a PDS through `com.atproto.sync.subscribeRepos`. Every event needs a `seq` that increases across the whole PDS, and consumers resume from a cursor. Commits happen in per-DID Durable Objects ([ADR 0003](./0003-store-each-repository-in-its-own-durable-object.md)), so no single transaction can write both a commit and a PDS-wide event log. A lost event leaves relays out of sync until they fetch the whole repository.

## Decision

- One `SequencerDO`, owned by the PDS, assigns `seq`, retains encoded event frames for 72 hours, and serves every WebSocket subscriber.
- `RepoDO` writes each commit's event to its own outbox in the commit transaction. It sends the outbox to the sequencer in order before the write responds, and retries from an alarm when sending fails. A write never fails because its event could not be sequenced.
- The sequencer records the last outbox ID it accepted from each DID and ignores anything at or below it, so retries never duplicate events.
- `@minisphere/repo-do` owns event contents. The PDS owns `seq`, retention, and subscriptions.

## Consequences

- Events are delivered at least once to the sequencer and exactly once to the stream, in commit order per DID.
- A committed write can appear on the firehose late if the sequencer is unavailable.
- One Durable Object bounds total event throughput, and a replay holds the retained backlog in memory. Sharding the sequencer would require a new decision.
- Consumers that fall more than 72 hours behind must resynchronize with `com.atproto.sync.getRepo`.

## References

- [AT Protocol event stream](https://atproto.com/specs/event-stream) and [sync](https://atproto.com/specs/sync) specifications
- [PDS firehose](../../apps/pds/README.md#firehose)
