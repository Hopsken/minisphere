import type * as GetRecord from "@atcute/atproto/types/repo/getRecord";
import type * as ListRecords from "@atcute/atproto/types/repo/listRecords";
import { getAtprotoHandle } from "@atcute/identity";
import { HandleResolutionError } from "@atcute/identity-resolver";
import type {
  DidDocumentResolver,
  HandleResolver,
} from "@atcute/identity-resolver";
import { isDid, isRecordKey } from "@atcute/lexicons/syntax";
import type { ActorIdentifier, Did } from "@atcute/lexicons/syntax";
import type { RepoDO } from "@minisphere/repo-do";

import type { AccountRepository } from "../repositories/account";
import { xrpcError } from "../utils/xrpc-error";

export class RepoReader {
  private readonly accounts: AccountRepository;
  private readonly documents: DidDocumentResolver;
  private readonly handles: HandleResolver;
  private readonly repositories: DurableObjectNamespace<RepoDO>;

  constructor(
    accounts: AccountRepository,
    repositories: DurableObjectNamespace<RepoDO>,
    handles: HandleResolver,
    documents: DidDocumentResolver
  ) {
    this.accounts = accounts;
    this.repositories = repositories;
    this.handles = handles;
    this.documents = documents;
  }

  async describe(identifier: ActorIdentifier) {
    const did = await this.resolveLocalDid(identifier);
    const [didDoc, repo] = await Promise.all([
      this.documents.resolve(did),
      this.repositories.getByName(did).rpcDescribeRepo(),
    ]);
    const claimedHandle = getAtprotoHandle(didDoc);
    let handleIsCorrect = false;
    if (claimedHandle) {
      try {
        handleIsCorrect = (await this.handles.resolve(claimedHandle)) === did;
      } catch (error) {
        if (!(error instanceof HandleResolutionError)) {
          throw error;
        }
      }
    }
    return {
      collections: repo.collections,
      did,
      didDoc,
      handle: claimedHandle ?? "handle.invalid",
      handleIsCorrect,
    };
  }

  async getRecord(params: GetRecord.$params) {
    const { collection, rkey, cid } = params;
    const did = await this.resolveLocalDid(params.repo);
    const record = await this.repositories
      .getByName(did)
      .rpcGetRecord(collection, rkey);
    if (!record || (cid !== undefined && cid !== record.cid)) {
      throw xrpcError(
        "RecordNotFound",
        `Could not locate record: ${collection}/${rkey}`
      );
    }
    return {
      cid: record.cid,
      uri: `at://${did}/${collection}/${rkey}`,
      value: record.record,
    };
  }

  async listRecords(params: ListRecords.$params) {
    if (params.cursor !== undefined && !isRecordKey(params.cursor)) {
      throw xrpcError("InvalidRequest", "Invalid record cursor");
    }
    const did = await this.resolveLocalDid(params.repo);
    return this.repositories.getByName(did).rpcListRecords({
      collection: params.collection,
      cursor: params.cursor,
      limit: params.limit ?? 50,
      reverse: params.reverse ?? false,
    });
  }

  async getRecordProof(did: Did, collection: string, rkey: string) {
    await this.resolveLocalDid(did);
    return this.repositories.getByName(did).rpcGetRecordProof(collection, rkey);
  }

  async getLatestCommit(did: Did) {
    await this.resolveLocalDid(did);
    const status = await this.repositories.getByName(did).rpcGetRepoStatus();
    return { cid: status.head, rev: status.rev };
  }

  async exportRepo(did: Did, since: string | undefined) {
    await this.resolveLocalDid(did);
    return this.repositories.getByName(did).rpcExportRepo(since);
  }

  /**
   * List hosted repositories by DID. Accounts whose repository cannot be read
   * are omitted; `getRepoStatus` reports them as desynchronized.
   */
  async listRepos(limit: number, cursor: string | undefined) {
    const dids = await this.accounts.list(limit + 1, cursor);
    const page = dids.slice(0, limit);
    const statuses = await Promise.allSettled(
      page.filter(isDid).map(async (did) => {
        const { head, rev } = await this.repositories
          .getByName(did)
          .rpcGetRepoStatus();
        return { active: true, did, head, rev };
      })
    );
    const repos = statuses.flatMap((status) =>
      status.status === "fulfilled" ? [status.value] : []
    );
    return {
      cursor: dids.length > limit ? page.at(-1) : undefined,
      repos,
    };
  }

  private async resolveLocalDid(identifier: ActorIdentifier): Promise<Did> {
    let did: Did;
    try {
      did = isDid(identifier)
        ? identifier
        : await this.handles.resolve(identifier);
    } catch (error) {
      if (error instanceof HandleResolutionError) {
        throw xrpcError(
          "RepoNotFound",
          `Could not resolve repo: ${identifier}`
        );
      }
      throw error;
    }
    if (!(await this.accounts.exists(did))) {
      throw xrpcError("RepoNotFound", `Repository is not hosted here: ${did}`);
    }
    return did;
  }
}
