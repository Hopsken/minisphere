import { CODEC_RAW, create, fromString, toString } from "@atcute/cid";
import type { Did } from "@atcute/lexicons/syntax";
import { ScopePermissions } from "@atproto/oauth-scopes";
import type { RepoDO } from "@minisphere/repo-do";
import { isTypeValid, parse as parseContentType } from "content-type";
import { getStreamAsArrayBuffer, MaxBufferError } from "get-stream";
import { HTTPException } from "hono/http-exception";

import { resourceError } from "../auth/resource";
import type { AccountRepository } from "../repositories/account";
import { xrpcError } from "../utils/xrpc-error";

const MAX_BLOB_BYTES = 10 * 1000 * 1000;

const parseBlobContentType = (header: string | null) => {
  const { type: mimeType } = parseContentType(
    header ?? "application/octet-stream",
    { parameters: false }
  );
  if (!isTypeValid(mimeType) || mimeType.includes("*")) {
    throw xrpcError("InvalidRequest", "Invalid Content-Type");
  }
  return mimeType;
};

export class Blobs {
  private readonly bucket: R2Bucket;
  private readonly repositories: DurableObjectNamespace<RepoDO>;
  private readonly accounts: AccountRepository;

  constructor(
    bucket: R2Bucket,
    repositories: DurableObjectNamespace<RepoDO>,
    accounts: AccountRepository
  ) {
    this.bucket = bucket;
    this.repositories = repositories;
    this.accounts = accounts;
  }

  async upload(request: Request, did: Did, scope: string) {
    const mimeType = parseBlobContentType(request.headers.get("Content-Type"));
    const permissions = new ScopePermissions(scope);
    const permit = (mime: string) => {
      if (!permissions.allowsBlob({ mime })) {
        throw resourceError(
          "insufficient_scope",
          "Blob upload permission is required for this MIME type",
          403
        );
      }
    };
    permit(mimeType);
    const declared = request.headers.get("Content-Length");
    if (declared !== null && !/^\d+$/u.test(declared)) {
      throw xrpcError("InvalidRequest", "Invalid Content-Length");
    }
    if (declared !== null && Number(declared) > MAX_BLOB_BYTES) {
      throw new HTTPException(413, {
        message: `Blob exceeds ${MAX_BLOB_BYTES} bytes`,
      });
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = request.body
        ? new Uint8Array(
            await getStreamAsArrayBuffer(request.body, {
              maxBuffer: MAX_BLOB_BYTES,
            })
          )
        : new Uint8Array();
    } catch (error) {
      if (error instanceof MaxBufferError) {
        throw new HTTPException(413, {
          message: `Blob exceeds ${MAX_BLOB_BYTES} bytes`,
        });
      }
      // get-stream errors can contain bufferedData; never log uploaded bytes.
      throw xrpcError("InvalidRequest", "Could not read uploaded bytes");
    }
    const size = bytes.byteLength;
    if (declared !== null && Number(declared) !== size) {
      throw xrpcError(
        "InvalidRequest",
        "Content-Length does not match the uploaded bytes"
      );
    }
    const cid = toString(await create(CODEC_RAW, bytes));
    const repo = this.repositories.getByName(did);
    let stored = await repo.rpcGetBlob(cid);
    if (!stored) {
      const key = `${did}/${cid}/${crypto.randomUUID()}`;
      // A successful R2 write precedes registration. Interrupted or concurrent
      // uploads can leave private objects; physical reclamation is deferred.
      await this.bucket.put(key, bytes);
      stored = await repo.rpcRegisterBlob({ cid, key, mimeType, size });
    }
    permit(stored.mimeType);
    return {
      blob: {
        $type: "blob" as const,
        mimeType: stored.mimeType,
        ref: { $link: stored.cid },
        size: stored.size,
      },
    };
  }

  private async localRepo(did: Did) {
    if (!(await this.accounts.exists(did))) {
      throw xrpcError("RepoNotFound", "Repository is not hosted here");
    }
    return this.repositories.getByName(did);
  }

  async get(did: Did, cid: string) {
    try {
      if (fromString(cid).codec !== CODEC_RAW) {
        throw new Error("Expected raw CID");
      }
    } catch {
      throw xrpcError("InvalidRequest", "Invalid blob CID");
    }
    const repo = await this.localRepo(did);
    const metadata = await repo.rpcGetBlob(cid);
    if (!metadata) {
      throw xrpcError("BlobNotFound", "Blob is not publicly available");
    }
    const object = await this.bucket.get(metadata.key);
    if (!object) {
      throw xrpcError("BlobNotFound", "Blob content is missing");
    }
    return {
      body: object.body,
      mimeType: metadata.mimeType,
      size: object.size,
    };
  }

  async list(
    did: Did,
    options: {
      limit?: number;
      cursor?: string | undefined;
      since?: string | undefined;
    }
  ) {
    const repo = await this.localRepo(did);
    return repo.rpcListBlobs({ ...options, limit: options.limit ?? 500 });
  }
}
