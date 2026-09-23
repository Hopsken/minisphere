import { now } from "@atcute/tid";
import type { Secp256k1Keypair } from "@atproto/crypto";
import { isLexMap } from "@atproto/lex-data";
import { lexParse } from "@atproto/lex-json";
import { BlockMap, WriteOpAction } from "@atproto/repo";
import type { Repo, RecordWriteOp } from "@atproto/repo";

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
  | { error: "InvalidSwap" | "InvalidRequest"; message: string }
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

export const prepareCommit = async (
  repo: Repo,
  keypair: Secp256k1Keypair,
  input: RepoWriteRequest
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
  const operations: RecordWriteOp[] = [];
  const results: RepoWriteResult[] = [];
  for (const write of input.writes) {
    const rkey = write.rkey ?? now();
    const path = `${write.collection}/${rkey}`;
    if (!current.has(path)) {
      // Later operations in a batch observe earlier operations on this path.
      // oxlint-disable-next-line no-await-in-loop
      const previousCid = await repo.data.get(path);
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
        operations.push({
          action: WriteOpAction.Delete,
          collection: write.collection,
          rkey,
        });
      }
      current.set(path, null);
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
      result.cid = cid;
      if (previous !== cid) {
        operations.push({
          action: previous ? WriteOpAction.Update : WriteOpAction.Create,
          collection: write.collection,
          record,
          rkey,
        });
      }
      current.set(path, cid);
    }
    results.push(result);
  }
  const commit = operations.length
    ? await repo.formatCommit(operations, keypair)
    : null;
  if (commit && commit.relevantBlocks.byteSize > 2_000_000) {
    return { error: "InvalidRequest", message: "Commit is too large" } as const;
  }
  return { commit, results };
};
