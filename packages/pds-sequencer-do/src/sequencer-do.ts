import { Buffer } from "node:buffer";

import { decode, encode } from "@atcute/cbor";
import { concat } from "@atcute/uint8array";
import { DurableObject } from "cloudflare:workers";
import { asc, eq, gt, lt, lte, max } from "drizzle-orm";

import { createDatabase } from "./db";
import type { Database } from "./db";
import { eventsTable, repoSourcesTable } from "./db/schema";

export const SEQUENCER_NAME = "firehose";

/**
 * A repository event to sequence: a `com.atproto.sync.subscribeRepos` message
 * body without `seq`. `id` increases per repository in commit order.
 */
export interface RepoEvent {
  id: number;
  type: string;
  body: Uint8Array;
}

// Consumers reconnecting within this window resume from their cursor; older
// cursors restart from the oldest retained event and must resync via getRepo.
const RETENTION_MS = 72 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

const LAST_SEQ_KEY = "lastSeq";
const PRUNED_THROUGH_KEY = "prunedThrough";

// An event stream frame is a DAG-CBOR header followed by the DAG-CBOR body.
type FrameHeader = { op: 1; t: string } | { op: -1 };

const frame = (header: FrameHeader, body: Uint8Array) =>
  concat([encode(header), body]);

/**
 * Assigns the PDS-wide `seq` to repository events, retains their encoded
 * frames, and serves them to `com.atproto.sync.subscribeRepos` WebSockets.
 * One instance serves the whole PDS so `seq` is totally ordered.
 */
export class SequencerDO extends DurableObject<Record<string, never>> {
  private readonly db: Database;

  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    const { db, waitMigrations } = createDatabase(ctx.storage);
    this.db = db;
    void ctx.blockConcurrencyWhile(async () => {
      await Promise.resolve(waitMigrations());
    });
  }

  /**
   * Sequence one repository's events in `id` order and return the last
   * accepted `id`. Events at or below it were sequenced by an earlier attempt
   * whose result the caller did not receive; they are skipped.
   */
  async rpcSequence(did: string, events: RepoEvent[]): Promise<number> {
    const accepted =
      this.db
        .select({ lastEventId: repoSourcesTable.lastEventId })
        .from(repoSourcesTable)
        .where(eq(repoSourcesTable.did, did))
        .get()?.lastEventId ?? 0;
    const pending = events.filter((event) => event.id > accepted);
    const lastEvent = pending.at(-1);
    if (!lastEvent) {
      return accepted;
    }

    const firstSeq = this.lastSeq() + 1;
    const createdAt = Date.now();
    const sequenced = pending.map((event, index) => {
      const seq = firstSeq + index;
      const body = encode({ ...decode(event.body), seq });
      return { createdAt, frame: frame({ op: 1, t: event.type }, body), seq };
    });
    this.db.transaction((transaction) => {
      for (const row of sequenced) {
        transaction
          .insert(eventsTable)
          .values({ ...row, frame: Buffer.from(row.frame) })
          .run();
      }
      transaction
        .insert(repoSourcesTable)
        .values({ did, lastEventId: lastEvent.id })
        .onConflictDoUpdate({
          set: { lastEventId: lastEvent.id },
          target: repoSourcesTable.did,
        })
        .run();
      this.ctx.storage.kv.put(LAST_SEQ_KEY, firstSeq + sequenced.length - 1);
    });

    this.broadcast(sequenced.map((row) => row.frame));
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
    }
    return lastEvent.id;
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
    const prunedThrough = this.db
      .select({ seq: max(eventsTable.seq) })
      .from(eventsTable)
      .where(lt(eventsTable.createdAt, Date.now() - RETENTION_MS))
      .get()?.seq;
    if (prunedThrough) {
      this.db.transaction((transaction) => {
        transaction
          .delete(eventsTable)
          .where(lte(eventsTable.seq, prunedThrough))
          .run();
        this.ctx.storage.kv.put(PRUNED_THROUGH_KEY, prunedThrough);
      });
    }
    if (this.db.select().from(eventsTable).limit(1).get()) {
      await this.ctx.storage.setAlarm(Date.now() + PRUNE_INTERVAL_MS);
    }
  }

  private lastSeq() {
    return this.ctx.storage.kv.get<number>(LAST_SEQ_KEY) ?? 0;
  }

  private broadcast(frames: Uint8Array[]) {
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
  }

  private replay(socket: WebSocket, cursor: number) {
    if (cursor > this.lastSeq()) {
      const error = encode({
        error: "FutureCursor",
        message: "Cursor is ahead of the latest event",
      });
      socket.send(frame({ op: -1 }, error));
      socket.close(1008, "FutureCursor");
      return;
    }
    if (cursor < (this.ctx.storage.kv.get<number>(PRUNED_THROUGH_KEY) ?? 0)) {
      const info = encode({
        message: "Events after the cursor expired; replaying the oldest",
        name: "OutdatedCursor",
      });
      socket.send(frame({ op: 1, t: "#info" }, info));
    }
    const { sql, params } = this.db
      .select({ frame: eventsTable.frame })
      .from(eventsTable)
      .where(gt(eventsTable.seq, cursor))
      .orderBy(asc(eventsTable.seq))
      .toSQL();
    // The native SQLite cursor reads rows lazily as they are sent.
    const rows = this.ctx.storage.sql.exec<{ frame: ArrayBuffer }>(
      sql,
      ...params
    );
    for (const { frame: bytes } of rows) {
      socket.send(bytes);
    }
  }
}
