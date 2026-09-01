import type { AuthContext } from "better-auth";
import { isDpopProofError } from "better-auth/oauth2";
import type { HonoRequest } from "hono";

import {
  redirectUriMatches,
  resolveAtprotoClientMetadata,
} from "./client-metadata";
import { DpopNonceError, verifyAtprotoDpop } from "./dpop";
import {
  createResponseNonce,
  endpoint,
  expiresAt,
  jsonResponse,
  OAuthError,
  oauthErrorResponse,
  readForm,
  requireParameter,
} from "./http";
import {
  PAR_LIFETIME_MS,
  PKCE_REPLAY_LIFETIME_MS,
  REQUEST_URI_PREFIX,
} from "./oauth-state";
import type { AuthorizationRequest } from "./oauth-state";
import { assertParResponse } from "./protocol-validation";
import { createUniqueRecord, reserveRecord } from "./storage";
import type {
  AtprotoClientMetadata,
  AtprotoOAuthProviderOptions,
} from "./types";

const parseAuthorizationRequest = async (
  form: URLSearchParams,
  options: AtprotoOAuthProviderOptions,
  supportedScopes: string[]
): Promise<AuthorizationRequest> => {
  const clientId = requireParameter(form, "client_id");
  let metadata: AtprotoClientMetadata;
  try {
    metadata = options.clientMetadataFetch
      ? await resolveAtprotoClientMetadata(
          clientId,
          options.clientMetadataFetch
        )
      : await resolveAtprotoClientMetadata(clientId);
  } catch {
    throw new OAuthError("invalid_client", "Client metadata is invalid");
  }
  const redirectUri = requireParameter(form, "redirect_uri");
  if (!redirectUriMatches(redirectUri, metadata)) {
    throw new OAuthError("invalid_request", "redirect_uri is not registered");
  }
  if (requireParameter(form, "response_type") !== "code") {
    throw new OAuthError(
      "unsupported_response_type",
      "response_type must be code"
    );
  }
  if (form.get("response_mode") && form.get("response_mode") !== "query") {
    throw new OAuthError(
      "invalid_request",
      "Only query response mode is supported"
    );
  }

  const codeChallenge = requireParameter(form, "code_challenge");
  if (!/^[A-Za-z\d_-]{43}$/u.test(codeChallenge)) {
    throw new OAuthError(
      "invalid_request",
      "code_challenge must be an S256 value"
    );
  }
  if (requireParameter(form, "code_challenge_method") !== "S256") {
    throw new OAuthError(
      "invalid_request",
      "code_challenge_method must be S256"
    );
  }

  const state = requireParameter(form, "state");
  if (state.length > 512) {
    throw new OAuthError("invalid_request", "state is too large");
  }
  const scope = requireParameter(form, "scope").split(" ");
  const loginHint = form.get("login_hint");
  if (
    scope.some((value) => !value) ||
    new Set(scope).size !== scope.length ||
    !scope.includes("atproto") ||
    scope.some(
      (value) =>
        !metadata.scopes.includes(value) || !supportedScopes.includes(value)
    )
  ) {
    throw new OAuthError("invalid_scope", "Requested scope is not supported");
  }

  const authorizationRequest: AuthorizationRequest = {
    clientId,
    codeChallenge,
    metadata,
    redirectUri,
    scope,
    state,
  };
  if (loginHint) {
    authorizationRequest.loginHint = loginHint;
  }
  return authorizationRequest;
};

export const handlePar = async (
  request: HonoRequest,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions,
  supportedScopes: string[]
) => {
  const responseNonce = await createResponseNonce(context);
  try {
    const proof = await verifyAtprotoDpop({
      adapter: context.internalAdapter,
      method: "POST",
      proofJwt: request.raw.headers.get("DPoP"),
      url: endpoint(options.issuer, "/oauth/par"),
    });
    const form = await readForm(
      request,
      new Set([
        "client_id",
        "code_challenge",
        "code_challenge_method",
        "login_hint",
        "redirect_uri",
        "response_mode",
        "response_type",
        "scope",
        "state",
      ])
    );
    const authorizationRequest = await parseAuthorizationRequest(
      form,
      options,
      supportedScopes
    );

    const replayExpiry = expiresAt(PKCE_REPLAY_LIFETIME_MS);
    if (
      !(await reserveRecord(
        context.internalAdapter,
        "pkce-challenge",
        authorizationRequest.codeChallenge,
        true,
        replayExpiry
      ))
    ) {
      throw new OAuthError(
        "invalid_request",
        "code_challenge has already been used"
      );
    }
    if (
      !(await reserveRecord(
        context.internalAdapter,
        "state",
        authorizationRequest.state,
        true,
        replayExpiry
      ))
    ) {
      throw new OAuthError("invalid_request", "state has already been used");
    }

    const parToken = await createUniqueRecord(
      context.internalAdapter,
      "par",
      {
        jwkThumbprint: proof.jkt,
        request: authorizationRequest,
      },
      expiresAt(PAR_LIFETIME_MS)
    );
    const responseBody = {
      expires_in: PAR_LIFETIME_MS / 1000,
      request_uri: `${REQUEST_URI_PREFIX}${parToken}`,
    };
    assertParResponse(responseBody);
    return jsonResponse(responseBody, 201, responseNonce);
  } catch (error) {
    if (
      !(error instanceof OAuthError) &&
      !(error instanceof DpopNonceError) &&
      !isDpopProofError(error)
    ) {
      context.logger.error("AT Protocol PAR failed", error);
    }
    return oauthErrorResponse(
      error instanceof Error ? error : null,
      responseNonce
    );
  }
};
