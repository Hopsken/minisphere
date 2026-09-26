import { encode } from "@atproto/lex-cbor";
import type { Cid } from "@atproto/lex-data";
import { BlockMap, blocksToCarFile } from "@atproto/repo";
import type { CommitData, Repo } from "@atproto/repo";
import type { SequencerDO } from "@minisphere/pds-sequencer-do";

/** The host Worker binds the PDS event sequencer as `SEQUENCER`. */
export interface RepoEnv {
  SEQUENCER: DurableObjectNamespace<SequencerDO>;
}

/**
 * The `com.atproto.sync.subscribeRepos` messages RepoDO emits. The Lexicon
 * union is open, so storage keeps the type as text.
 */
export type RepoEventType = "#account" | "#commit" | "#identity" | "#sync";

/** A queued message body; the sequencer assigns its `seq`. */
export interface OutboxEvent {
  type: RepoEventType;
  body: Uint8Array;
}

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
