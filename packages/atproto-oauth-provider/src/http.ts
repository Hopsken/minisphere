import type { AuthContext } from "better-auth";
import { isDpopProofError } from "better-auth/oauth2";
import type { HonoRequest } from "hono";
import { z } from "zod";

import { DpopNonceError } from "./dpop";
import { DPOP_NONCE_LIFETIME_MS } from "./oauth-state";
import { assertAuthorizationServerMetadata } from "./protocol-validation";
import { createUniqueRecord } from "./storage";

const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const encoder = new TextEncoder();
const formValueSchema = z.string();

export const FORM_BODY_LIMIT_BYTES = 16 * 1024;

type JsonValue =
  | boolean
  | JsonObject
  | JsonValue[]
  | null
  | number
  | string
  | undefined;

export interface JsonObject {
  [key: string]: JsonValue;
}

export class OAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, description: string, status = 400) {
    super(description);
    this.name = "OAuthError";
    this.code = code;
    this.status = status;
  }
}

export const expiresAt = (lifetimeMs: number) =>
  new Date(Date.now() + lifetimeMs);

export const assertOrigin = (value: string, field: string) => {
  const url = new URL(value);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && url.hostname !== "localhost")
  ) {
    throw new TypeError(`${field} must be an HTTPS origin`);
  }
  return url.origin;
};

export const endpoint = (issuer: string, path: string) => `${issuer}${path}`;

export const protocolHeaders = (nonce?: string) => {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Content-Type, DPoP",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "DPoP-Nonce, WWW-Authenticate",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
  if (nonce) {
    headers.set("DPoP-Nonce", nonce);
  }
  return headers;
};

export const jsonResponse = (
  body: JsonObject,
  status = 200,
  nonce?: string
) => {
  const headers = protocolHeaders(nonce);
  return Response.json(body, { headers, status });
};

export const oauthErrorResponse = (error: Error | null, nonce?: string) => {
  if (error instanceof DpopNonceError) {
    return jsonResponse(
      {
        error: "use_dpop_nonce",
        error_description: error.message,
      },
      400,
      nonce
    );
  }
  if (isDpopProofError(error)) {
    return jsonResponse(
      {
        error: "invalid_dpop_proof",
        error_description: error.message,
      },
      400,
      nonce
    );
  }
  if (error instanceof OAuthError) {
    return jsonResponse(
      { error: error.code, error_description: error.message },
      error.status,
      nonce
    );
  }
  return jsonResponse(
    {
      error: "server_error",
      error_description:
        "The authorization server could not process the request",
    },
    500,
    nonce
  );
};

export const readForm = async (
  request: HonoRequest,
  allowedFields: Set<string>
) => {
  const contentType = request.header("Content-Type")?.split(";", 1)[0];
  if (contentType?.trim().toLowerCase() !== FORM_CONTENT_TYPE) {
    throw new OAuthError(
      "invalid_request",
      `Content-Type must be ${FORM_CONTENT_TYPE}`
    );
  }

  let body: Awaited<ReturnType<HonoRequest["parseBody"]>>;
  try {
    body = await request.parseBody({ all: true });
  } catch {
    throw new OAuthError("invalid_request", "Request body is malformed");
  }

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (!allowedFields.has(key)) {
      throw new OAuthError("invalid_request", `Unsupported parameter: ${key}`);
    }
    if (Array.isArray(value)) {
      throw new OAuthError("invalid_request", `Duplicate parameter: ${key}`);
    }
    const parsedValue = formValueSchema.safeParse(value);
    if (!parsedValue.success) {
      throw new OAuthError("invalid_request", `Invalid parameter: ${key}`);
    }
    form.set(key, parsedValue.data);
  }
  return form;
};

export const requireParameter = (parameters: URLSearchParams, name: string) => {
  const value = parameters.get(name);
  if (!value) {
    throw new OAuthError("invalid_request", `${name} is required`);
  }
  return value;
};

export const authorizationRedirect = (location: string) =>
  new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: location,
      Pragma: "no-cache",
    },
    status: 302,
  });

export const sha256Base64Url = async (value: string) => {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value))
  );
  let binary = "";
  for (const byte of hash) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export const createResponseNonce = (context: AuthContext) =>
  createUniqueRecord(
    context.internalAdapter,
    "dpop-nonce",
    true,
    expiresAt(DPOP_NONCE_LIFETIME_MS)
  );

export const metadataResponse = (
  issuer: string,
  jwksUri: string,
  supportedScopes: string[]
) => {
  const headers = protocolHeaders();
  headers.set("Cache-Control", "public, max-age=300");
  headers.delete("Pragma");
  const body = {
    authorization_endpoint: endpoint(issuer, "/oauth/authorize"),
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    code_challenge_methods_supported: ["S256"],
    dpop_signing_alg_values_supported: ["ES256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    issuer,
    jwks_uri: jwksUri,
    pushed_authorization_request_endpoint: endpoint(issuer, "/oauth/par"),
    request_uri_parameter_supported: true,
    require_pushed_authorization_requests: true,
    response_modes_supported: ["query"],
    response_types_supported: ["code"],
    revocation_endpoint: endpoint(issuer, "/oauth/revoke"),
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: supportedScopes,
    token_endpoint: endpoint(issuer, "/oauth/token"),
    token_endpoint_auth_methods_supported: ["none"],
  };
  assertAuthorizationServerMetadata(body);
  return Response.json(body, { headers, status: 200 });
};
