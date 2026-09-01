import type { AuthContext } from "better-auth";
import { isDpopProofError } from "better-auth/oauth2";
import type { HonoRequest } from "hono";

import { DpopNonceError, verifyAtprotoDpop, verifySessionDpop } from "./dpop";
import {
  createResponseNonce,
  endpoint,
  expiresAt,
  jsonResponse,
  OAuthError,
  oauthErrorResponse,
  readForm,
  requireParameter,
  sha256Base64Url,
} from "./http";
import type { JsonObject } from "./http";
import {
  ACCESS_TOKEN_LIFETIME_SECONDS,
  PUBLIC_SESSION_LIFETIME_MS,
} from "./oauth-state";
import type {
  AuthorizationCodeRecord,
  IssuedTokenSet,
  OAuthSessionRecord,
  SessionTokenRecord,
} from "./oauth-state";
import { assertTokenResponse } from "./protocol-validation";
import {
  consumeRecord,
  createUniqueRecord,
  deleteRecord,
  findRecord,
  reserveRecord,
} from "./storage";
import type { AtprotoOAuthProviderOptions } from "./types";

interface TokenResponseBody extends JsonObject {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  sub: string;
  token_type: "DPoP";
}

const issueTokenSet = async (
  sessionId: string,
  session: OAuthSessionRecord,
  sessionExpiresAt: Date,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions,
  includeRefreshToken: boolean
) => {
  const accessToken = await options.issueAccessToken({
    audience: options.resource,
    clientId: session.clientId,
    expiresIn: ACCESS_TOKEN_LIFETIME_SECONDS,
    issuer: options.issuer,
    jwkThumbprint: session.jwkThumbprint,
    scope: session.scope.join(" "),
    subject: session.did,
  });
  if (
    !(await reserveRecord(
      context.internalAdapter,
      "access-token",
      accessToken,
      { sessionId } satisfies SessionTokenRecord,
      expiresAt(ACCESS_TOKEN_LIFETIME_SECONDS * 1000)
    ))
  ) {
    throw new Error("Access-token issuer returned a duplicate token");
  }

  const refreshToken = includeRefreshToken
    ? await createUniqueRecord<SessionTokenRecord>(
        context.internalAdapter,
        "refresh-token",
        { sessionId },
        sessionExpiresAt
      )
    : undefined;
  const tokens: IssuedTokenSet = { accessToken };
  if (refreshToken) {
    tokens.refreshToken = refreshToken;
  }
  return tokens;
};

const tokenResponse = (session: OAuthSessionRecord, tokens: IssuedTokenSet) => {
  const body: TokenResponseBody = {
    access_token: tokens.accessToken,
    expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
    scope: session.scope.join(" "),
    sub: session.did,
    token_type: "DPoP",
  };
  if (tokens.refreshToken) {
    body.refresh_token = tokens.refreshToken;
  }
  assertTokenResponse(body);
  return jsonResponse(body);
};

const handleAuthorizationCodeGrant = async (
  form: URLSearchParams,
  request: HonoRequest,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions,
  responseNonce: string
) => {
  const code = requireParameter(form, "code");
  const codeRecord = await findRecord<AuthorizationCodeRecord>(
    context.internalAdapter,
    "authorization-code",
    code
  );
  if (!codeRecord) {
    throw new OAuthError(
      "invalid_grant",
      "Authorization code is invalid or expired"
    );
  }
  if (
    requireParameter(form, "client_id") !== codeRecord.request.clientId ||
    requireParameter(form, "redirect_uri") !== codeRecord.request.redirectUri
  ) {
    throw new OAuthError(
      "invalid_grant",
      "Authorization code binding does not match"
    );
  }

  const verifier = requireParameter(form, "code_verifier");
  if (
    !/^[A-Za-z\d._~-]{43,128}$/u.test(verifier) ||
    (await sha256Base64Url(verifier)) !== codeRecord.request.codeChallenge
  ) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }
  await verifyAtprotoDpop({
    adapter: context.internalAdapter,
    expectedJkt: codeRecord.jwkThumbprint,
    method: "POST",
    proofJwt: request.raw.headers.get("DPoP"),
    url: endpoint(options.issuer, "/oauth/token"),
  });

  const consumed = await consumeRecord<AuthorizationCodeRecord>(
    context.internalAdapter,
    "authorization-code",
    code
  );
  if (!consumed) {
    throw new OAuthError(
      "invalid_grant",
      "Authorization code has already been used"
    );
  }

  const sessionExpiresAt = expiresAt(PUBLIC_SESSION_LIFETIME_MS);
  const session: OAuthSessionRecord = {
    clientId: consumed.request.clientId,
    did: consumed.did,
    expiresAt: sessionExpiresAt.getTime(),
    jwkThumbprint: consumed.jwkThumbprint,
    scope: consumed.request.scope,
  };
  const sessionId = await createUniqueRecord(
    context.internalAdapter,
    "session",
    session,
    sessionExpiresAt
  );

  try {
    const tokens = await issueTokenSet(
      sessionId,
      session,
      sessionExpiresAt,
      context,
      options,
      consumed.request.metadata.grantTypes.includes("refresh_token")
    );
    const response = tokenResponse(session, tokens);
    response.headers.set("DPoP-Nonce", responseNonce);
    return response;
  } catch (error) {
    await deleteRecord(context.internalAdapter, "session", sessionId);
    throw error;
  }
};

const handleRefreshTokenGrant = async (
  form: URLSearchParams,
  request: HonoRequest,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions,
  responseNonce: string
) => {
  const refreshToken = requireParameter(form, "refresh_token");
  const clientId = requireParameter(form, "client_id");
  const current = await findRecord<SessionTokenRecord>(
    context.internalAdapter,
    "refresh-token",
    refreshToken
  );
  const replay = current
    ? null
    : await findRecord<SessionTokenRecord>(
        context.internalAdapter,
        "used-refresh-token",
        refreshToken
      );
  const tokenRecord = current ?? replay;
  const session = tokenRecord
    ? await findRecord<OAuthSessionRecord>(
        context.internalAdapter,
        "session",
        tokenRecord.sessionId
      )
    : null;

  await verifySessionDpop(request, context, options, "/oauth/token", session);
  if (!tokenRecord || !session || session.clientId !== clientId) {
    throw new OAuthError(
      "invalid_grant",
      "Refresh token is invalid or expired"
    );
  }
  if (replay) {
    await deleteRecord(
      context.internalAdapter,
      "session",
      tokenRecord.sessionId
    );
    throw new OAuthError(
      "invalid_grant",
      "Refresh token replay revoked the session"
    );
  }

  const consumed = await consumeRecord<SessionTokenRecord>(
    context.internalAdapter,
    "refresh-token",
    refreshToken
  );
  if (!consumed) {
    await deleteRecord(
      context.internalAdapter,
      "session",
      tokenRecord.sessionId
    );
    throw new OAuthError(
      "invalid_grant",
      "Refresh token has already been used"
    );
  }
  const sessionRecord = await findRecord<OAuthSessionRecord>(
    context.internalAdapter,
    "session",
    consumed.sessionId
  );
  if (!sessionRecord) {
    throw new OAuthError("invalid_grant", "OAuth session has expired");
  }
  const used = await reserveRecord(
    context.internalAdapter,
    "used-refresh-token",
    refreshToken,
    consumed,
    new Date(sessionRecord.expiresAt)
  );
  if (!used) {
    await deleteRecord(context.internalAdapter, "session", consumed.sessionId);
    throw new OAuthError(
      "invalid_grant",
      "Refresh token replay revoked the session"
    );
  }

  try {
    const tokens = await issueTokenSet(
      consumed.sessionId,
      sessionRecord,
      new Date(sessionRecord.expiresAt),
      context,
      options,
      true
    );
    const response = tokenResponse(sessionRecord, tokens);
    response.headers.set("DPoP-Nonce", responseNonce);
    return response;
  } catch (error) {
    await deleteRecord(context.internalAdapter, "session", consumed.sessionId);
    throw error;
  }
};

export const handleToken = async (
  request: HonoRequest,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions
) => {
  const responseNonce = await createResponseNonce(context);
  try {
    const form = await readForm(
      request,
      new Set([
        "client_id",
        "code",
        "code_verifier",
        "grant_type",
        "redirect_uri",
        "refresh_token",
      ])
    );
    const grantType = requireParameter(form, "grant_type");
    if (grantType === "authorization_code") {
      if (form.has("refresh_token")) {
        throw new OAuthError(
          "invalid_request",
          "refresh_token is not valid for an authorization code grant"
        );
      }
      return await handleAuthorizationCodeGrant(
        form,
        request,
        context,
        options,
        responseNonce
      );
    }
    if (grantType === "refresh_token") {
      if (
        form.has("code") ||
        form.has("code_verifier") ||
        form.has("redirect_uri")
      ) {
        throw new OAuthError(
          "invalid_request",
          "Authorization code parameters are not valid for a refresh grant"
        );
      }
      return await handleRefreshTokenGrant(
        form,
        request,
        context,
        options,
        responseNonce
      );
    }
    throw new OAuthError("unsupported_grant_type", "Unsupported grant_type");
  } catch (error) {
    if (
      !(error instanceof OAuthError) &&
      !(error instanceof DpopNonceError) &&
      !isDpopProofError(error)
    ) {
      context.logger.error("AT Protocol token request failed", error);
    }
    return oauthErrorResponse(
      error instanceof Error ? error : null,
      responseNonce
    );
  }
};
