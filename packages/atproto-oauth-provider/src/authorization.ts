import type { AuthContext } from "better-auth";
import { parseCookies } from "better-auth/cookies";
import type { HonoRequest } from "hono";

import {
  authorizationRedirect,
  expiresAt,
  OAuthError,
  oauthErrorResponse,
  readForm,
  requireParameter,
} from "./http";
import {
  AUTHORIZATION_CODE_LIFETIME_MS,
  AUTHORIZATION_INTERACTION_LIFETIME_MS,
  REQUEST_URI_PREFIX,
} from "./oauth-state";
import type {
  AuthorizationCodeRecord,
  AuthorizationRequest,
  ConsentRecord,
} from "./oauth-state";
import { consumeRecord, createUniqueRecord } from "./storage";
import type { AtprotoOAuthProviderOptions } from "./types";

const encoder = new TextEncoder();

const readUserSession = async (request: HonoRequest, context: AuthContext) => {
  const cookieHeader = request.raw.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }
  const signedValue = parseCookies(cookieHeader).get(
    context.authCookies.sessionToken.name
  );
  if (!signedValue) {
    return null;
  }

  const separator = signedValue.lastIndexOf(".");
  if (separator < 1) {
    return null;
  }
  const value = signedValue.slice(0, separator);
  const signature = signedValue.slice(separator + 1);

  let signatureBytes: ArrayBuffer;
  try {
    const binary = atob(signature);
    signatureBytes = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(signatureBytes);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.codePointAt(index) ?? 0;
    }
  } catch {
    return null;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(context.secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encoder.encode(value)
  );
  if (!valid) {
    return null;
  }

  const session = await context.internalAdapter.findSession(value);
  if (!session || session.session.expiresAt < new Date()) {
    return null;
  }
  return session;
};

const addAuthorizationResponseParameters = (
  request: AuthorizationRequest,
  issuer: string,
  parameters: Record<string, string>
) => {
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("iss", issuer);
  redirect.searchParams.set("state", request.state);
  for (const [name, value] of Object.entries(parameters)) {
    redirect.searchParams.set(name, value);
  }
  return redirect.href;
};

const createLoginRedirect = async (
  request: AuthorizationRequest,
  jwkThumbprint: string,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions
) => {
  const interaction = await createUniqueRecord(
    context.internalAdapter,
    "interaction",
    { jwkThumbprint, request },
    expiresAt(AUTHORIZATION_INTERACTION_LIFETIME_MS)
  );
  const returnTo = `/oauth/authorize?interaction=${encodeURIComponent(interaction)}`;
  const loginUrl = new URL(await options.getLoginUrl(returnTo), options.issuer);
  if (loginUrl.origin !== options.issuer) {
    throw new Error("getLoginUrl must return an issuer-local URL");
  }
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: `${loginUrl.pathname}${loginUrl.search}${loginUrl.hash}`,
      Pragma: "no-cache",
    },
    status: 302,
  });
};

const localRedirect = async (
  destination: string | Promise<string>,
  issuer: string
) => {
  const url = new URL(await destination, issuer);
  if (url.origin !== issuer) {
    throw new Error("Redirect callback must return an issuer-local URL");
  }
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: `${url.pathname}${url.search}${url.hash}`,
      Pragma: "no-cache",
    },
    status: 302,
  });
};

const renderConsent = async (
  browserRequest: HonoRequest,
  request: AuthorizationRequest,
  jwkThumbprint: string,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions
) => {
  const userSession = await readUserSession(browserRequest, context);
  if (!userSession) {
    return createLoginRedirect(request, jwkThumbprint, context, options);
  }

  const authorizationSubject = await options.getAuthorizationSubject(
    userSession.user.id
  );
  if (!authorizationSubject) {
    return localRedirect(options.getAccountCompletionUrl(), options.issuer);
  }
  if (
    request.loginHint &&
    request.loginHint !== authorizationSubject.did &&
    request.loginHint !== authorizationSubject.handle
  ) {
    throw new OAuthError(
      "access_denied",
      "Authenticated account does not match login_hint"
    );
  }
  const consentToken = await createUniqueRecord<ConsentRecord>(
    context.internalAdapter,
    "consent",
    {
      jwkThumbprint,
      request,
      subjectDid: authorizationSubject.did,
      userId: userSession.user.id,
    },
    expiresAt(AUTHORIZATION_INTERACTION_LIFETIME_MS)
  );
  const page = await options.renderAuthorizationPage({
    clientId: request.clientId,
    consentToken,
    scope: request.scope.join(" "),
    subject: authorizationSubject,
  });
  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-store");
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
  );
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(page.body, { headers, status: page.status });
};

export const handleAuthorizeGet = async (
  request: HonoRequest,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions
) => {
  try {
    const url = new URL(request.url);
    const keys = [...new Set(url.searchParams.keys())];
    if (
      keys.some(
        (key) => !["client_id", "interaction", "request_uri"].includes(key)
      )
    ) {
      throw new OAuthError(
        "invalid_request",
        "Unsupported authorization parameter"
      );
    }
    for (const key of keys) {
      if (url.searchParams.getAll(key).length !== 1) {
        throw new OAuthError("invalid_request", `Duplicate parameter: ${key}`);
      }
    }

    const interaction = url.searchParams.get("interaction");
    if (interaction) {
      if (
        url.searchParams.has("client_id") ||
        url.searchParams.has("request_uri")
      ) {
        throw new OAuthError(
          "invalid_request",
          "Invalid authorization continuation"
        );
      }
      const continuation = await consumeRecord<{
        jwkThumbprint: string;
        request: AuthorizationRequest;
      }>(context.internalAdapter, "interaction", interaction);
      if (!continuation) {
        throw new OAuthError(
          "invalid_request",
          "Authorization interaction is invalid"
        );
      }
      return renderConsent(
        request,
        continuation.request,
        continuation.jwkThumbprint,
        context,
        options
      );
    }

    const clientId = url.searchParams.get("client_id");
    const requestUri = url.searchParams.get("request_uri");
    if (!clientId || !requestUri?.startsWith(REQUEST_URI_PREFIX)) {
      throw new OAuthError(
        "invalid_request",
        "Authorization requires client_id and a PAR request_uri"
      );
    }
    const par = await consumeRecord<{
      jwkThumbprint: string;
      request: AuthorizationRequest;
    }>(
      context.internalAdapter,
      "par",
      requestUri.slice(REQUEST_URI_PREFIX.length)
    );
    if (!par || par.request.clientId !== clientId) {
      throw new OAuthError(
        "invalid_request",
        "PAR request_uri is invalid or expired"
      );
    }
    return renderConsent(
      request,
      par.request,
      par.jwkThumbprint,
      context,
      options
    );
  } catch (error) {
    if (!(error instanceof OAuthError)) {
      context.logger.error("AT Protocol authorization failed", error);
    }
    return oauthErrorResponse(error instanceof Error ? error : null);
  }
};

export const handleAuthorizePost = async (
  request: HonoRequest,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions
) => {
  try {
    if (request.raw.headers.get("origin") !== options.issuer) {
      throw new OAuthError(
        "invalid_request",
        "Invalid authorization form origin"
      );
    }
    const form = await readForm(
      request,
      new Set(["consent_token", "decision"])
    );
    const consentToken = requireParameter(form, "consent_token");
    const consent = await consumeRecord<ConsentRecord>(
      context.internalAdapter,
      "consent",
      consentToken
    );
    if (!consent) {
      throw new OAuthError(
        "invalid_request",
        "Authorization consent is invalid"
      );
    }
    const userSession = await readUserSession(request, context);
    if (!userSession || userSession.user.id !== consent.userId) {
      throw new OAuthError(
        "access_denied",
        "Authenticated user does not match consent"
      );
    }

    const decision = requireParameter(form, "decision");
    if (decision === "deny") {
      return authorizationRedirect(
        addAuthorizationResponseParameters(consent.request, options.issuer, {
          error: "access_denied",
        })
      );
    }
    if (decision !== "allow") {
      throw new OAuthError("invalid_request", "decision must be allow or deny");
    }

    const subject = await options.getAuthorizationSubject(consent.userId);
    if (!subject || subject.did !== consent.subjectDid) {
      throw new OAuthError(
        "access_denied",
        "Authorization subject is no longer active for this user"
      );
    }

    const code = await createUniqueRecord<AuthorizationCodeRecord>(
      context.internalAdapter,
      "authorization-code",
      {
        did: subject.did,
        jwkThumbprint: consent.jwkThumbprint,
        request: consent.request,
      },
      expiresAt(AUTHORIZATION_CODE_LIFETIME_MS)
    );
    return authorizationRedirect(
      addAuthorizationResponseParameters(consent.request, options.issuer, {
        code,
      })
    );
  } catch (error) {
    if (!(error instanceof OAuthError)) {
      context.logger.error("AT Protocol authorization decision failed", error);
    }
    return oauthErrorResponse(error instanceof Error ? error : null);
  }
};
