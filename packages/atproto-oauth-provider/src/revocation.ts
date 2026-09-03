import type { AuthContext } from "better-auth";
import { isDpopProofError } from "better-auth/oauth2";
import type { HonoRequest } from "hono";

import { DpopNonceError, verifySessionDpop } from "./dpop";
import {
  createResponseNonce,
  jsonResponse,
  OAuthError,
  oauthErrorResponse,
  readProtocolParameters,
  requireParameter,
} from "./http";
import type { OAuthSessionRecord, SessionTokenRecord } from "./oauth-state";
import { deleteRecord, findRecord } from "./storage";
import type { AtprotoOAuthProviderOptions } from "./types";

export const handleRevoke = async (
  request: HonoRequest,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions
) => {
  const responseNonce = await createResponseNonce(context);
  try {
    const form = await readProtocolParameters(
      request,
      new Set(["client_id", "token", "token_type_hint"])
    );
    const token = requireParameter(form, "token");
    const clientId = requireParameter(form, "client_id");
    const tokenRecord =
      (await findRecord<SessionTokenRecord>(
        context.internalAdapter,
        "access-token",
        token
      )) ??
      (await findRecord<SessionTokenRecord>(
        context.internalAdapter,
        "refresh-token",
        token
      )) ??
      (await findRecord<SessionTokenRecord>(
        context.internalAdapter,
        "used-refresh-token",
        token
      ));
    const session = tokenRecord
      ? await findRecord<OAuthSessionRecord>(
          context.internalAdapter,
          "session",
          tokenRecord.sessionId
        )
      : null;

    await verifySessionDpop(
      request,
      context,
      options,
      "/oauth/revoke",
      session
    );
    if (session && session.clientId === clientId && tokenRecord) {
      await deleteRecord(
        context.internalAdapter,
        "session",
        tokenRecord.sessionId
      );
    }
    return jsonResponse({}, 200, responseNonce);
  } catch (error) {
    if (
      !(error instanceof OAuthError) &&
      !(error instanceof DpopNonceError) &&
      !isDpopProofError(error)
    ) {
      context.logger.error("AT Protocol revocation failed", error);
    }
    return oauthErrorResponse(
      error instanceof Error ? error : null,
      responseNonce
    );
  }
};
