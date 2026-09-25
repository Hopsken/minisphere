import { encode } from "@atproto/lex-cbor";
import type { Cid } from "@atproto/lex-data";
import { BlockMap, blocksToCarFile } from "@atproto/repo";
import type { CommitData, Repo } from "@atproto/repo";

import type { outboxTable } from "./db/schema";

export type RepoEventType = (typeof outboxTable.$inferSelect)["type"];

/**
 * A `com.atproto.sync.subscribeRepos` message body without `seq`, which the
 * sequencer assigns. `id` increases per repository in commit order.
 */
export interface RepoEvent {
  id: number;
  type: RepoEventType;
  body: Uint8Array;
}

/** Accepts one repository's events in `id` order and returns the last accepted `id`. */
export interface RepoEventSequencer {
  rpcSequence: (did: string, events: RepoEvent[]) => Promise<number>;
}

/** The host Worker binds the PDS event sequencer as `SEQUENCER`. */
export interface RepoEnv {
  SEQUENCER: { getByName: (name: string) => RepoEventSequencer };
}

export const SEQUENCER_NAME = "firehose";

// oxlint-disable-next-line typescript/consistent-type-definitions -- Unlike an interface, a type alias is assignable to the CBOR encoder's LexValue map.
export type RepoEventOp = {
  action: "create" | "update" | "delete";
  path: string;
  cid: Cid | null;
  prev?: Cid;
};

export const commitEvent = (
  did: string,
  commit: CommitData,
  car: Uint8Array,
  prevData: Cid,
  ops: RepoEventOp[]
) => ({
  body: encode({
    blobs: [],
    blocks: car,
    commit: commit.cid,
    ops,
    prevData,
    rebase: false,
    repo: did,
    rev: commit.rev,
    since: commit.since,
    time: new Date().toISOString(),
    tooBig: false,
  }),
  type: "#commit" as const,
});

/**
 * Announce a newly hosted account: its handle, active status, and current
 * commit, so relays start from this state without a preceding diff.
 */
export const accountAnnouncementEvents = async (repo: Repo, handle: string) => {
  const commit = await repo.storage.getBytes(repo.cid);
  if (!commit) {
    throw new Error("Repository commit block is missing");
  }
  const blocks = new BlockMap();
  blocks.set(repo.cid, commit);
  const time = new Date().toISOString();
  return [
    {
      body: encode({ did: repo.did, handle, time }),
      type: "#identity" as const,
    },
    {
      body: encode({ active: true, did: repo.did, time }),
      type: "#account" as const,
    },
    {
      body: encode({
        blocks: await blocksToCarFile(repo.cid, blocks),
        did: repo.did,
        rev: repo.commit.rev,
        time,
      }),
      type: "#sync" as const,
    },
  ];
};
