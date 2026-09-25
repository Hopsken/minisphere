import { Buffer } from "node:buffer";

import { decode, encode } from "@atcute/cbor";
import type { RepoEvent, RepoEventSequencer } from "@minisphere/repo-do";
import { DurableObject } from "cloudflare:workers";
import { asc, eq, gt, lt, lte, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import migrations from "./migrations/migrations";
import { eventsTable, repoSourcesTable } from "./schema";

// Consumers reconnecting within this window resume from their cursor; older
// cursors restart from the oldest retained event and must resync via getRepo.
const RETENTION_MS = 72 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const REPLAY_PAGE_SIZE = 100;

// An event stream frame is a DAG-CBOR header followed by the DAG-CBOR body.
type FrameHeader = { op: 1; t: string } | { op: -1 };

const frame = (header: FrameHeader, body: Uint8Array) => {
  const head = encode(header);
  const bytes = new Uint8Array(head.byteLength + body.byteLength);
  bytes.set(head);
  bytes.set(body, head.byteLength);
  return bytes;
};

/**
 * Assigns the PDS-wide `seq` to repository events, retains their encoded
 * `com.atproto.sync.subscribeRepos` frames, and serves them to WebSocket
 * consumers. One instance serves the whole PDS so `seq` is totally ordered.
 */
export class SequencerDO
  extends DurableObject<Env>
  implements RepoEventSequencer
{
  private readonly db = drizzle(this.ctx.storage);
  private lastSeq = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const result = await Promise.resolve(migrate(this.db, migrations));
      if (result !== undefined) {
        throw new Error(`[DB] migrations failed with code: ${result.exitCode}`);
      }
      this.lastSeq = ctx.storage.kv.get<number>("lastSeq") ?? 0;
    });
  }

  async rpcSequence(did: string, events: RepoEvent[]): Promise<number> {
    const source = this.db
      .select()
      .from(repoSourcesTable)
      .where(eq(repoSourcesTable.did, did))
      .get();
    let lastEventId = source?.lastEventId ?? 0;
    // A retry after an unknown result resends events that are already sequenced.
    const pending = events.filter((event) => event.id > lastEventId);
    if (pending.length === 0) {
      return lastEventId;
    }

    const frames: Uint8Array[] = [];
    let seq = this.lastSeq;
    const createdAt = Date.now();
    this.db.transaction((transaction) => {
      for (const event of pending) {
        seq += 1;
        const bytes = frame(
          { op: 1, t: event.type },
          encode({ ...decode(event.body), seq })
        );
        transaction
          .insert(eventsTable)
          .values({ createdAt, frame: Buffer.from(bytes), seq })
          .run();
        frames.push(bytes);
        lastEventId = event.id;
      }
      transaction
        .insert(repoSourcesTable)
        .values({ did, lastEventId })
        .onConflictDoUpdate({
          set: { lastEventId },
          target: repoSourcesTable.did,
        })
        .run();
      this.ctx.storage.kv.put("lastSeq", seq);
    });
    this.lastSeq = seq;

    for (const socket of this.ctx.getWebSockets()) {
      try {
        for (const bytes of frames) {
          socket.send(bytes);
        }
      } catch (error) {
        // A closing socket is removed by the runtime; other consumers continue.
        console.warn("could not send firehose event", error);
      }
    }
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
    }
    return lastEventId;
  }

  override fetch(request: Request): Response {
    const cursor = new URL(request.url).searchParams.get("cursor");
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    // Replay synchronously: no new event can interleave before the socket is live.
    if (cursor !== null) {
      this.replay(server, Number(cursor));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async alarm(): Promise<void> {
    const expired = this.db
      .select({ seq: max(eventsTable.seq) })
      .from(eventsTable)
      .where(lt(eventsTable.createdAt, Date.now() - RETENTION_MS))
      .get();
    if (expired?.seq) {
      const prunedThrough = expired.seq;
      this.db.transaction((transaction) => {
        transaction
          .delete(eventsTable)
          .where(lte(eventsTable.seq, prunedThrough))
          .run();
        this.ctx.storage.kv.put("prunedThrough", prunedThrough);
      });
    }
    if (this.db.select().from(eventsTable).limit(1).get()) {
      await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
    }
  }

  private replay(socket: WebSocket, cursor: number) {
    if (cursor > this.lastSeq) {
      socket.send(
        frame(
          { op: -1 },
          encode({
            error: "FutureCursor",
            message: "Cursor is ahead of the latest event",
          })
        )
      );
      socket.close(1008, "FutureCursor");
      return;
    }
    if (cursor < (this.ctx.storage.kv.get<number>("prunedThrough") ?? 0)) {
      socket.send(
        frame(
          { op: 1, t: "#info" },
          encode({
            message: "Events after the cursor expired; replaying the oldest",
            name: "OutdatedCursor",
          })
        )
      );
    }
    let after = cursor;
    for (;;) {
      const rows = this.db
        .select()
        .from(eventsTable)
        .where(gt(eventsTable.seq, after))
        .orderBy(asc(eventsTable.seq))
        .limit(REPLAY_PAGE_SIZE)
        .all();
      for (const row of rows) {
        socket.send(row.frame);
      }
      const last = rows.at(-1);
      if (!last || rows.length < REPLAY_PAGE_SIZE) {
        return;
      }
      after = last.seq;
    }
  }
}
