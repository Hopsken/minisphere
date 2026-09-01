import { z } from "zod";

import {
  assertClientPresentationUrls,
  assertLoopbackRedirect,
  assertPublicClientId,
  assertRedirectUri,
  assertUnique,
} from "./client-metadata-validation";
import {
  assertLoopbackClientMetadata,
  parseAtprotoScopes,
  parsePublicClientMetadataDocument,
} from "./protocol-validation";
import type { AtprotoClientMetadata } from "./types";

const MAX_METADATA_BYTES = 100 * 1024;
const METADATA_TIMEOUT_MS = 5000;

const readJsonBody = async (response: Response) => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_METADATA_BYTES) {
    throw new TypeError("Client metadata document is too large");
  }

  if (!response.body) {
    throw new TypeError("Client metadata response has no body");
  }

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let length = 0;
  while (true) {
    // A stream reader is sequential; the next read is not available in advance.
    // oxlint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.length;
    if (length > MAX_METADATA_BYTES) {
      // Cancellation must finish before the oversized response is rejected.
      // oxlint-disable-next-line no-await-in-loop
      await reader.cancel();
      throw new TypeError("Client metadata document is too large");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  try {
    return z.json().parse(JSON.parse(new TextDecoder().decode(body)));
  } catch {
    throw new TypeError("Client metadata document must contain JSON");
  }
};

const resolveLoopbackMetadata = (clientId: string): AtprotoClientMetadata => {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new TypeError("client_id must be a URL");
  }

  const queryStart = clientId.indexOf("?");
  const base = queryStart === -1 ? clientId : clientId.slice(0, queryStart);
  if (
    (base !== "http://localhost" && base !== "http://localhost/") ||
    url.protocol !== "http:" ||
    url.hostname !== "localhost" ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.hash
  ) {
    throw new TypeError("Invalid localhost client_id");
  }

  for (const key of url.searchParams.keys()) {
    if (key !== "redirect_uri" && key !== "scope") {
      throw new TypeError(`Unsupported localhost client_id parameter: ${key}`);
    }
  }
  if (url.searchParams.getAll("scope").length > 1) {
    throw new TypeError("Localhost client_id must contain at most one scope");
  }

  const redirectUris = url.searchParams.getAll("redirect_uri");
  if (redirectUris.length === 0) {
    redirectUris.push("http://127.0.0.1/", "http://[::1]/");
  }
  assertUnique(redirectUris, "redirect_uris");
  for (const redirectUri of redirectUris) {
    assertLoopbackRedirect(redirectUri);
  }
  const scope = url.searchParams.get("scope") ?? "atproto";
  assertLoopbackClientMetadata(redirectUris, scope);

  return {
    applicationType: "native",
    clientId,
    grantTypes: ["authorization_code", "refresh_token"],
    redirectUris,
    scopes: parseAtprotoScopes(scope),
  };
};

const resolveFetchedMetadata = async (
  clientId: string,
  fetcher: typeof fetch
): Promise<AtprotoClientMetadata> => {
  const clientUrl = assertPublicClientId(clientId);
  const response = await fetcher(clientUrl, {
    headers: { accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  if (response.status !== 200 || response.redirected) {
    throw new TypeError(
      "Client metadata request must return HTTP 200 directly"
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase();
  if (!contentType?.startsWith("application/json")) {
    throw new TypeError("Client metadata response must use application/json");
  }

  const metadata = parsePublicClientMetadataDocument(
    await readJsonBody(response)
  );
  if (metadata.client_id !== clientId) {
    throw new TypeError(
      "Client metadata client_id must match its document URL"
    );
  }
  if (
    metadata.jwks !== undefined ||
    metadata.jwks_uri !== undefined ||
    metadata.token_endpoint_auth_signing_alg !== undefined
  ) {
    throw new TypeError("Confidential client metadata is not supported");
  }

  assertUnique(metadata.grant_types, "grant_types");
  assertUnique(metadata.response_types, "response_types");
  assertUnique(metadata.redirect_uris, "redirect_uris");
  if (
    !metadata.grant_types.includes("authorization_code") ||
    metadata.grant_types.some(
      (grant) => grant !== "authorization_code" && grant !== "refresh_token"
    ) ||
    !metadata.response_types.includes("code") ||
    metadata.response_types.some((responseType) => responseType !== "code")
  ) {
    throw new TypeError(
      "Client grant_types and response_types are unsupported"
    );
  }

  const applicationType = metadata.application_type ?? "web";
  for (const redirectUri of metadata.redirect_uris) {
    assertRedirectUri(redirectUri, applicationType, clientUrl);
  }
  const grantTypes: AtprotoClientMetadata["grantTypes"] =
    metadata.grant_types.map((grant) =>
      grant === "refresh_token" ? "refresh_token" : "authorization_code"
    );

  assertClientPresentationUrls(metadata, clientUrl);

  return {
    applicationType,
    clientId,
    grantTypes,
    redirectUris: metadata.redirect_uris,
    scopes: parseAtprotoScopes(metadata.scope),
  };
};

export const resolveAtprotoClientMetadata = async (
  clientId: string,
  fetcher: typeof fetch = fetch
) => {
  if (clientId.startsWith("http://")) {
    return resolveLoopbackMetadata(clientId);
  }
  const metadata = await resolveFetchedMetadata(clientId, fetcher);
  return metadata;
};

export const redirectUriMatches = (
  redirectUri: string,
  metadata: AtprotoClientMetadata
) => {
  if (!metadata.clientId.startsWith("http://localhost")) {
    return metadata.redirectUris.includes(redirectUri);
  }

  let requested: URL;
  try {
    requested = new URL(redirectUri);
    assertLoopbackRedirect(redirectUri);
  } catch {
    return false;
  }
  requested.port = "";

  return metadata.redirectUris.some((registered) => {
    const candidate = new URL(registered);
    candidate.port = "";
    return candidate.href === requested.href;
  });
};
