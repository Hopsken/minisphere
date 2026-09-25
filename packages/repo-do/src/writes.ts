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
  finalCids: Map<string, Cid | null>
) => {
  const ops: RepoEventOp[] = [];
  for (const [path, cid] of finalCids) {
    const prev = initialCids.get(path);
    if (cid && prev) {
      if (cid.toString() !== prev.toString()) {
        ops.push({ action: "update", cid, path, prev });
      }
    } else if (cid) {
      ops.push({ action: "create", cid, path });
    } else if (prev) {
      ops.push({ action: "delete", cid, path, prev });
    }
  }
  return ops;
};

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
  const current = new Map<string, string | null>();
  // Net record changes per path; the firehose reports these, not batch steps.
  const initialCids = new Map<string, Cid | null>();
  const finalCids = new Map<string, Cid | null>();
  const operations: RecordWriteOp[] = [];
  const results: RepoWriteResult[] = [];
  const references: RecordBlobChanges = new Map();
  for (const write of input.writes) {
    const rkey = write.rkey ?? now();
    const path = `${write.collection}/${rkey}`;
    if (!current.has(path)) {
      // Later operations in a batch observe earlier operations on this path.
      // oxlint-disable-next-line no-await-in-loop
      const previousCid = await repo.data.get(path);
      initialCids.set(path, previousCid ?? null);
      current.set(path, previousCid?.toString() ?? null);
    }
    const previous = current.get(path) ?? null;
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
      current.set(path, null);
      finalCids.set(path, null);
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
      current.set(path, cid);
      finalCids.set(path, recordCid);
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
  const ops = netRecordOps(initialCids, finalCids);
  return { car, commit, ops, references, results };
};
