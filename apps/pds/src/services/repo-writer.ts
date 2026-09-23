import type * as ApplyWrites from "@atcute/atproto/types/repo/applyWrites";
import type * as CreateRecord from "@atcute/atproto/types/repo/createRecord";
import type * as DeleteRecord from "@atcute/atproto/types/repo/deleteRecord";
import type * as PutRecord from "@atcute/atproto/types/repo/putRecord";
import * as Post from "@atcute/bluesky/types/app/feed/post";
import { HandleResolutionError } from "@atcute/identity-resolver";
import type { HandleResolver } from "@atcute/identity-resolver";
import { isDid } from "@atcute/lexicons/syntax";
import type { ActorIdentifier, Did } from "@atcute/lexicons/syntax";
import { safeParse } from "@atcute/lexicons/validations";
import { ScopePermissions } from "@atproto/oauth-scopes";
import type { RepoDO, RepoWrite } from "@minisphere/repo-do";
import { z } from "zod";

import { resourceError } from "../auth/resource";
import { xrpcError } from "../utils/xrpc-error";

const recordSchema = z.record(z.string(), z.unknown());

// Bound nesting before either a schema validator or a CBOR encoder recurses.
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This is the record-data input validator, including recursion limits before Lexicon parsing. */
const checkRecordValues = (value: unknown, depth = 0): void => {
  if (depth > 32) {
    throw xrpcError("InvalidRecord", "Record nesting is too deep");
  }
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw xrpcError("InvalidRecord", "Record numbers must be safe integers");
  }
  if (value && typeof value === "object") {
    if ("$type" in value && value.$type === "blob") {
      throw xrpcError("InvalidRecord", "Blob writes are not supported");
    }
    for (const child of Object.values(value)) {
      checkRecordValues(child, depth + 1);
    }
  }
};

const prepareRecord = (
  collection: string,
  value: unknown,
  validate: boolean | undefined,
  rkey?: string
) => {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) {
    throw xrpcError("InvalidRecord", "Record must be a JSON object");
  }
  const record = {
    ...parsed.data,
    $type: parsed.data.$type === undefined ? collection : parsed.data.$type,
  };
  if (record.$type !== collection) {
    throw xrpcError("InvalidRecord", "Record type must match collection");
  }
  checkRecordValues(record);
  let validationStatus: "valid" | "unknown" = "unknown";
  if (validate !== false) {
    if (collection === "app.bsky.feed.post") {
      if (
        !safeParse(Post.mainSchema, record).ok ||
        (rkey !== undefined && !safeParse(Post.mainSchema.key, rkey).ok)
      ) {
        throw xrpcError(
          "InvalidRecord",
          "Invalid app.bsky.feed.post record or key"
        );
      }
      validationStatus = "valid";
    } else if (validate === true) {
      throw xrpcError("InvalidRecord", "Unknown record Lexicon");
    }
  }
  return { recordJson: JSON.stringify(record), validationStatus };
};
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof */

export class RepoWriter {
  private readonly permissions: ScopePermissions;
  private readonly subject: Did;
  private readonly handles: HandleResolver;
  private readonly repositories: DurableObjectNamespace<RepoDO>;

  constructor(
    subject: Did,
    scope: string,
    handles: HandleResolver,
    repositories: DurableObjectNamespace<RepoDO>
  ) {
    this.permissions = new ScopePermissions(scope);
    this.subject = subject;
    this.handles = handles;
    this.repositories = repositories;
  }

  private permit(collection: string, action: "create" | "update" | "delete") {
    if (!this.permissions.allowsRepo({ action, collection })) {
      throw resourceError(
        "insufficient_scope",
        "Record write permission is required",
        403
      );
    }
  }

  private async commit(
    repo: ActorIdentifier,
    writes: RepoWrite[],
    swapCommit?: string
  ) {
    let did: Did;
    try {
      did = isDid(repo) ? repo : await this.handles.resolve(repo);
    } catch (error) {
      if (error instanceof HandleResolutionError) {
        throw xrpcError("RepoNotFound", "Could not resolve repository");
      }
      throw error;
    }
    if (did !== this.subject) {
      throw resourceError(
        "insufficient_scope",
        "Cannot write another account's repository",
        403
      );
    }
    const result = await this.repositories.getByName(did).rpcApplyWrites({
      swapCommit,
      writes,
    });
    if ("error" in result) {
      throw xrpcError(result.error, result.message);
    }
    return result;
  }

  async create(input: CreateRecord.$input) {
    this.permit(input.collection, "create");
    const prepared = prepareRecord(
      input.collection,
      input.record,
      input.validate,
      input.rkey
    );
    const result = await this.commit(
      input.repo,
      [
        {
          action: "create",
          collection: input.collection,
          recordJson: prepared.recordJson,
          rkey: input.rkey,
        },
      ],
      input.swapCommit
    );
    return {
      ...result.results[0],
      commit: result.commit,
      validationStatus: prepared.validationStatus,
    };
  }

  async put(input: PutRecord.$input) {
    this.permit(input.collection, "create");
    this.permit(input.collection, "update");
    const prepared = prepareRecord(
      input.collection,
      input.record,
      input.validate,
      input.rkey
    );
    const result = await this.commit(
      input.repo,
      [
        {
          action: "put",
          collection: input.collection,
          recordJson: prepared.recordJson,
          rkey: input.rkey,
          swapRecord: input.swapRecord,
        },
      ],
      input.swapCommit
    );
    return {
      ...result.results[0],
      commit: result.commit,
      validationStatus: prepared.validationStatus,
    };
  }

  async delete(input: DeleteRecord.$input) {
    this.permit(input.collection, "delete");
    const result = await this.commit(
      input.repo,
      [
        {
          action: "delete",
          collection: input.collection,
          ensureAbsent: true,
          rkey: input.rkey,
          swapRecord: input.swapRecord,
        },
      ],
      input.swapCommit
    );
    return { commit: result.commit };
  }

  async apply(input: ApplyWrites.$input) {
    if (input.writes.length > 200) {
      throw xrpcError("InvalidRequest", "At most 200 writes are allowed");
    }
    const prepared = input.writes.map((write) => {
      if (write.$type === "com.atproto.repo.applyWrites#delete") {
        this.permit(write.collection, "delete");
        return {
          action: "delete",
          collection: write.collection,
          rkey: write.rkey,
        } as const;
      }
      if (
        write.$type !== "com.atproto.repo.applyWrites#create" &&
        write.$type !== "com.atproto.repo.applyWrites#update"
      ) {
        throw xrpcError("InvalidRequest", "Unknown write operation");
      }
      const action: "create" | "update" =
        write.$type === "com.atproto.repo.applyWrites#create"
          ? "create"
          : "update";
      this.permit(write.collection, action);
      return {
        action,
        collection: write.collection,
        rkey: write.rkey,
        ...prepareRecord(
          write.collection,
          write.value,
          input.validate,
          write.rkey
        ),
      };
    });
    const result = await this.commit(input.repo, prepared, input.swapCommit);
    return {
      commit: result.commit,
      results: result.results.map((record, index) => {
        const write = prepared[index];
        if (!write) {
          throw new Error("Missing write result");
        }
        return write.action === "delete"
          ? { $type: "com.atproto.repo.applyWrites#deleteResult" }
          : {
              ...record,
              $type: `com.atproto.repo.applyWrites#${write.action}Result`,
              validationStatus: write.validationStatus,
            };
      }),
    };
  }
}
