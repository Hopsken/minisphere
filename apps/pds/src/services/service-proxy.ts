import type { DidDocumentResolver } from "@atcute/identity-resolver";
import { isDid } from "@atcute/lexicons/syntax";
import type { Did } from "@atcute/lexicons/syntax";
import { ScopePermissionsTransition } from "@atproto/oauth-scopes";
import type { RepoDO } from "@minisphere/repo-do";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { resourceError } from "../auth/resource";
import { xrpcError } from "../utils/xrpc-error";

export const BSKY_APPVIEW = "did:web:api.bsky.app#bsky_appview";
const BSKY_CHAT = "did:web:api.bsky.chat#bsky_chat";

// Account management must reach its owner directly; it is never proxied and
// never authorized by a service token. `createAccount` would migrate the
// account elsewhere, which is not supported.
export const PROTECTED_METHODS = new Set([
  "com.atproto.admin.sendEmail",
  "com.atproto.identity.requestPlcOperationSignature",
  "com.atproto.identity.signPlcOperation",
  "com.atproto.identity.updateHandle",
  "com.atproto.server.activateAccount",
  "com.atproto.server.confirmEmail",
  "com.atproto.server.createAccount",
  "com.atproto.server.createAppPassword",
  "com.atproto.server.deactivateAccount",
  "com.atproto.server.getAccountInviteCodes",
  "com.atproto.server.getSession",
  "com.atproto.server.listAppPasswords",
  "com.atproto.server.requestAccountDelete",
  "com.atproto.server.requestEmailConfirmation",
  "com.atproto.server.requestEmailUpdate",
  "com.atproto.server.revokeAppPassword",
  "com.atproto.server.updateEmail",
]);

const REQUEST_HEADERS = new Set([
  "accept-language",
  "atproto-accept-labelers",
  "content-encoding",
  "content-type",
  "x-bsky-topics",
]);
const serviceEndpointSchema = z.url({ protocol: /^https$/u });
const RESPONSE_HEADERS = [
  "atproto-content-labelers",
  "atproto-repo-rev",
  "content-type",
  "retry-after",
];

const ENDPOINT_TTL_MS = 10 * 60 * 1000;
const ENDPOINT_CACHE_LIMIT = 100;
// Service endpoints are public DID document data, cached per isolate.
const endpoints = new Map<string, { endpoint: string; expiresAt: number }>();

/**
 * The `did#service` a method is sent to: the `atproto-proxy` header, or the
 * Bluesky AppView and chat services for their namespaces.
 */
export const proxyTarget = (lxm: string, header: string | undefined) => {
  if (header !== undefined) {
    return header;
  }
  if (lxm.startsWith("app.bsky.")) {
    return BSKY_APPVIEW;
  }
  return lxm.startsWith("chat.bsky.") ? BSKY_CHAT : null;
};

const parseTarget = (target: string) => {
  const [did, serviceId, ...rest] = target.split("#");
  if (!did || !isDid(did) || !serviceId || rest.length > 0) {
    throw xrpcError("InvalidRequest", "Invalid atproto-proxy header");
  }
  return { did, serviceId };
};

export class ServiceProxy {
  private readonly permissions: ScopePermissionsTransition;
  private readonly subject: Did;
  private readonly documents: DidDocumentResolver;
  private readonly repositories: DurableObjectNamespace<RepoDO>;

  constructor(
    subject: Did,
    scope: string,
    documents: DidDocumentResolver,
    repositories: DurableObjectNamespace<RepoDO>
  ) {
    this.permissions = new ScopePermissionsTransition(scope);
    this.subject = subject;
    this.documents = documents;
    this.repositories = repositories;
  }

  /** Checks that the caller may call `lxm` (or any method, `*`) on `aud`. */
  authorize(aud: string, lxm: string) {
    if (PROTECTED_METHODS.has(lxm)) {
      throw xrpcError("InvalidToken", "Bad token method");
    }
    if (!this.permissions.allowsRpc({ aud, lxm })) {
      throw resourceError(
        "insufficient_scope",
        "RPC permission is required for this service method",
        403
      );
    }
  }

  /** Signs an inter-service token with the account's repository key. */
  createServiceJwt(aud: string, lxm: string | null, exp?: number) {
    return this.repositories
      .getByName(this.subject)
      .rpcCreateServiceJwt({ aud, exp, lxm });
  }

  async forward(request: Request, lxm: string, target: string) {
    const { did, serviceId } = parseTarget(target);
    this.authorize(`${did}#${serviceId}`, lxm);
    const url = new URL(request.url);
    const upstream = new URL(
      `/xrpc/${lxm}${url.search}`,
      await this.resolveEndpoint(did, serviceId)
    );

    const headers = new Headers();
    for (const [name, value] of request.headers) {
      if (REQUEST_HEADERS.has(name) || name.startsWith("x-atproto-")) {
        headers.set(name, value);
      }
    }
    headers.set(
      "Authorization",
      `Bearer ${await this.createServiceJwt(did, lxm)}`
    );
    const response = await fetch(upstream, {
      body: request.method === "POST" ? request.body : null,
      headers,
      method: request.method,
      redirect: "manual",
    }).catch(() => {
      throw new HTTPException(502, {
        res: Response.json(
          { error: "UpstreamFailure", message: "Upstream service unreachable" },
          { status: 502 }
        ),
      });
    });

    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    for (const name of RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) {
        responseHeaders.set(name, value);
      }
    }
    return new Response(response.body, {
      headers: responseHeaders,
      status: response.status,
    });
  }

  private async resolveEndpoint(did: Did, serviceId: string) {
    const key = `${did}#${serviceId}`;
    const cached = endpoints.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.endpoint;
    }
    const document = await this.documents.resolve(did).catch(() => {
      throw xrpcError("InvalidRequest", "Could not resolve proxy DID");
    });
    const parsed = serviceEndpointSchema.safeParse(
      document.service?.find(
        (service) => service.id === `#${serviceId}` || service.id === key
      )?.serviceEndpoint
    );
    if (!parsed.success) {
      throw xrpcError(
        "InvalidRequest",
        "Proxy service must have an HTTPS endpoint"
      );
    }
    const endpoint = parsed.data;
    if (endpoints.size >= ENDPOINT_CACHE_LIMIT) {
      endpoints.clear();
    }
    endpoints.set(key, { endpoint, expiresAt: Date.now() + ENDPOINT_TTL_MS });
    return endpoint;
  }
}
