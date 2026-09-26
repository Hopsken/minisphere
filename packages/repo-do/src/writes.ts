import { now } from "@atcute/tid";
import type { Secp256k1Keypair } from "@atproto/crypto";
import { isLexMap } from "@atproto/lex-data";
import type { Cid } from "@atproto/lex-data";
import { lexParse } from "@atproto/lex-json";
import { BlockMap, blocksToCarFile, WriteOpAction } from "@atproto/repo";
import type { Repo, RecordWriteOp } from "@atproto/repo";

import { checkRecordBlobs } from "./blobs";
import type { BlobMetadata, RecordBlobChanges } from "./blobs";
import type { RepoEventOp } from "./events";

export interface RepoWrite {
  action: "create" | "update" | "put" | "delete";
  collection: RecordWriteOp["collection"];
  rkey?: string | undefined;
  recordJson?: string;
  swapRecord?: string | null | undefined;
  ensureAbsent?: boolean;
}

export interface RepoWriteRequest {
  writes: RepoWrite[];
  swapCommit?: string | undefined;
}

export interface RepoWriteResult {
  uri: string;
  cid?: string;
}

export type RepoWriteResponse =
  | {
      error: "InvalidSwap" | "InvalidRequest" | "InvalidRecord";
      message: string;
    }
  | { results: RepoWriteResult[]; commit: { cid: string; rev: string } };

const decodeRecord = (recordJson: string | undefined) => {
  try {
    const record = lexParse(recordJson ?? "null", { strict: true });
    return isLexMap(record) ? record : null;
  } catch {
    return null;
  }
};

const checkRecordPrecondition = (write: RepoWrite, previous: string | null) => {
  if (write.swapRecord !== undefined && write.swapRecord !== previous) {
    return { error: "InvalidSwap", message: "Record does not match" } as const;
  }
  if (write.action === "create" && previous) {
    return {
      error: "InvalidRequest",
      message: "Record already exists",
    } as const;
  }
  if (
    !previous &&
    (write.action === "update" ||
      (write.action === "delete" && !write.ensureAbsent))
  ) {
    return {
      error: "InvalidRequest",
      message: "Record does not exist",
    } as const;
  }
  return null;
};

const netRecordOps = (
  initialCids: Map<string, Cid | null>,
  latestCids: Map<string, Cid | null>
) =>
  [...latestCids].flatMap(([path, cid]): RepoEventOp[] => {
    const prev = initialCids.get(path) ?? null;
    if (cid && prev) {
      return cid.toString() === prev.toString()
        ? []
        : [{ action: "update", cid, path, prev }];
    }
    if (cid) {
      return [{ action: "create", cid, path }];
    }
    return prev ? [{ action: "delete", cid, path, prev }] : [];
  });

export const prepareCommit = async (
  repo: Repo,
  keypair: Secp256k1Keypair,
  input: RepoWriteRequest,
  lookupBlob: (cid: string) => BlobMetadata | undefined
) => {
  if (
    input.swapCommit !== undefined &&
    input.swapCommit !== repo.cid.toString()
  ) {
    return {
      error: "InvalidSwap",
      message: "Repository head does not match",
    } as const;
  }
  // Each path's record CID before the batch and after the writes so far.
  // Later writes observe earlier ones; the firehose reports the net change.
  const initialCids = new Map<string, Cid | null>();
  const latestCids = new Map<string, Cid | null>();
  const operations: RecordWriteOp[] = [];
  const results: RepoWriteResult[] = [];
  const references: RecordBlobChanges = new Map();
  for (const write of input.writes) {
    const rkey = write.rkey ?? now();
    const path = `${write.collection}/${rkey}`;
    if (!latestCids.has(path)) {
      // oxlint-disable-next-line no-await-in-loop
      const initial = (await repo.data.get(path)) ?? null;
      initialCids.set(path, initial);
      latestCids.set(path, initial);
    }
    const previous = latestCids.get(path)?.toString() ?? null;
    const conflict = checkRecordPrecondition(write, previous);
    if (conflict) {
      return conflict;
    }
    const result: RepoWriteResult = { uri: `at://${repo.did}/${path}` };
    if (write.action === "delete") {
      if (previous) {
        references.set(path, new Set());
        operations.push({
          action: WriteOpAction.Delete,
          collection: write.collection,
          rkey,
        });
      }
      latestCids.set(path, null);
    } else {
      const record = decodeRecord(write.recordJson);
      if (!record) {
        return {
          error: "InvalidRequest",
          message: "Record must be a valid Lexicon object",
        } as const;
      }
      // oxlint-disable-next-line no-await-in-loop -- Preserve ordered batch semantics.
      const recordCid = await new BlockMap().add(record);
      const cid = recordCid.toString();
      const blobs = new Set<string>();
      if (!checkRecordBlobs(record, lookupBlob, blobs)) {
        return {
          error: "InvalidRecord",
          message: "Blob is missing, expired, or has invalid metadata",
        } as const;
      }
      result.cid = cid;
      if (previous !== cid) {
        references.set(path, blobs);
        operations.push({
          action: previous ? WriteOpAction.Update : WriteOpAction.Create,
          collection: write.collection,
          record,
          rkey,
        });
      }
      latestCids.set(path, recordCid);
    }
    results.push(result);
  }
  const commit = operations.length
    ? await repo.formatCommit(operations, keypair)
    : null;
  if (!commit) {
    return { commit, references, results };
  }
  // Firehose commit events carry these blocks as a CAR of at most 2,000,000 bytes.
  const car = await blocksToCarFile(commit.cid, commit.relevantBlocks);
  if (car.byteLength > 2_000_000) {
    return { error: "InvalidRequest", message: "Commit is too large" } as const;
  }
  const ops = netRecordOps(initialCids, latestCids);
  return { car, commit, ops, references, results };
};
