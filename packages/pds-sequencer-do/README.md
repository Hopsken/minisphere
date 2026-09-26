# PDS sequencer

`@minisphere/pds-sequencer-do` serves the PDS firehose, `com.atproto.sync.subscribeRepos`. One SQLite Durable Object, `SequencerDO`, named `SEQUENCER_NAME`, sequences the events of every repository on the PDS. See [ADR 0012](../../docs/adr/0012-sequence-repository-events-in-one-durable-object.md).

The package owns event sequence numbers, retained event frames, and each repository's last accepted event ID, together with their schema and migrations. It does not own event contents: [`@minisphere/repo-do`](../repo-do/README.md) builds them.

Guarantees:

- `rpcSequence(did, events)` accepts one repository's events in ID order and returns the last accepted ID. Events at or below an ID it already accepted are ignored, so retries never duplicate events.
- `seq` increases across the PDS and is never reused, including after pruning.
- `fetch()` accepts a WebSocket upgrade. A `cursor` query parameter first replays every retained event after it; the connection then receives new events as they are sequenced.
- Events are retained for 72 hours. See the [PDS firehose contract](../../apps/pds/README.md#firehose) for cursor errors.

## Migrations

Define tables in `src/db/schema.ts`, then generate a named migration:

```sh
pnpm --filter @minisphere/pds-sequencer-do db:generate add-event-column
```

The Durable Object applies the generated migrations in `migrations/` before it accepts requests.

## Development

```sh
pnpm --filter @minisphere/pds-sequencer-do typecheck
```
