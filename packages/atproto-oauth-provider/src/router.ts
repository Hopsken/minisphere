import type { AuthContext } from "better-auth";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import {
  handleAuthorizationDetailsGet,
  handleAuthorizeGet,
  handleAuthorizePost,
} from "./authorization";
import {
  createResponseNonce,
  endpoint,
  FORM_BODY_LIMIT_BYTES,
  jsonResponse,
  metadataResponse,
  OAuthError,
  oauthErrorResponse,
  protocolHeaders,
} from "./http";
import { handlePar } from "./par";
import { handleRevoke } from "./revocation";
import { handleToken } from "./token";
import type { AtprotoOAuthProviderOptions } from "./types";

const AUTHORIZATION_PATH = "/oauth/authorize";
const AUTHORIZATION_DETAILS_PATH = "/oauth/authorization-details";
const METADATA_PATH = "/.well-known/oauth-authorization-server";
const JWKS_PATH = "/oauth/jwks";
const PAR_PATH = "/oauth/par";
const REVOCATION_PATH = "/oauth/revoke";
const TOKEN_PATH = "/oauth/token";

const protocolPaths = new Set([PAR_PATH, REVOCATION_PATH, TOKEN_PATH]);
const oauthPaths = new Set([
  AUTHORIZATION_DETAILS_PATH,
  AUTHORIZATION_PATH,
  JWKS_PATH,
  METADATA_PATH,
  ...protocolPaths,
]);

interface OAuthRouterBindings {
  authContext: AuthContext;
}

interface OAuthRouterEnv {
  Bindings: OAuthRouterBindings;
}

const protocolMethodNotAllowed = () =>
  jsonResponse(
    {
      error: "invalid_request",
      error_description: "POST is required",
    },
    405
  );

const methodNotAllowed = () => new Response(null, { status: 405 });

const preflightResponse = () =>
  new Response(null, { headers: protocolHeaders(), status: 200 });

const authorizationBodyLimit = bodyLimit({
  maxSize: FORM_BODY_LIMIT_BYTES,
  onError: () =>
    oauthErrorResponse(
      new OAuthError("invalid_request", "Request body is too large")
    ),
});

const protocolBodyLimit = bodyLimit({
  maxSize: FORM_BODY_LIMIT_BYTES,
  onError: async (context) => {
    const nonce = await createResponseNonce(context.env.authContext);
    return oauthErrorResponse(
      new OAuthError("invalid_request", "Request body is too large"),
      nonce
    );
  },
});

export const isAtprotoOAuthPath = (path: string) => oauthPaths.has(path);

export const createAtprotoOAuthRouter = (
  options: AtprotoOAuthProviderOptions,
  supportedScopes: string[]
) => {
  const router = new Hono<OAuthRouterEnv>();

  router.use("*", async (context, next) => {
    if (context.req.raw.method === "HEAD") {
      return protocolPaths.has(context.req.path)
        ? protocolMethodNotAllowed()
        : methodNotAllowed();
    }
    return await next();
  });

  router
    .get(METADATA_PATH, () =>
      metadataResponse(
        options.issuer,
        endpoint(options.issuer, JWKS_PATH),
        supportedScopes
      )
    )
    .all(METADATA_PATH, methodNotAllowed)
    .get(JWKS_PATH, async () => {
      const headers = protocolHeaders();
      headers.set("Cache-Control", "public, max-age=300");
      headers.delete("Pragma");
      return Response.json(await options.getJwks(), { headers });
    })
    .all(JWKS_PATH, methodNotAllowed)
    .get(AUTHORIZATION_PATH, (context) =>
      handleAuthorizeGet(context.req, context.env.authContext, options)
    )
    .post(AUTHORIZATION_PATH, authorizationBodyLimit, (context) =>
      handleAuthorizePost(context.req, context.env.authContext, options)
    )
    .all(AUTHORIZATION_PATH, methodNotAllowed)
    .get(AUTHORIZATION_DETAILS_PATH, (context) =>
      handleAuthorizationDetailsGet(
        context.req,
        context.env.authContext,
        options
      )
    )
    .all(AUTHORIZATION_DETAILS_PATH, methodNotAllowed)
    .options(PAR_PATH, preflightResponse)
    .post(PAR_PATH, protocolBodyLimit, (context) =>
      handlePar(context.req, context.env.authContext, options, supportedScopes)
    )
    .all(PAR_PATH, protocolMethodNotAllowed)
    .options(TOKEN_PATH, preflightResponse)
    .post(TOKEN_PATH, protocolBodyLimit, (context) =>
      handleToken(context.req, context.env.authContext, options)
    )
    .all(TOKEN_PATH, protocolMethodNotAllowed)
    .options(REVOCATION_PATH, preflightResponse)
    .post(REVOCATION_PATH, protocolBodyLimit, (context) =>
      handleRevoke(context.req, context.env.authContext, options)
    )
    .all(REVOCATION_PATH, protocolMethodNotAllowed);

  return router;
};
