import type { BetterAuthPlugin } from "better-auth";

import { assertOrigin } from "./http";
import { createAtprotoOAuthRouter, isAtprotoOAuthPath } from "./router";
import type { AtprotoOAuthProviderOptions } from "./types";

export const atprotoOAuthProvider = (
  providerOptions: AtprotoOAuthProviderOptions
): BetterAuthPlugin => {
  const options = {
    ...providerOptions,
    issuer: assertOrigin(providerOptions.issuer, "issuer"),
    resource: assertOrigin(providerOptions.resource, "resource"),
  };
  const supportedScopes = options.supportedScopes ?? ["atproto"];
  if (
    !supportedScopes.includes("atproto") ||
    new Set(supportedScopes).size !== supportedScopes.length
  ) {
    throw new TypeError(
      "supportedScopes must contain unique values and atproto"
    );
  }
  const router = createAtprotoOAuthRouter(options, supportedScopes);

  return {
    id: "atproto-oauth-provider",
    onRequest: async (request, context) => {
      const url = new URL(request.url);
      if (url.origin !== options.issuer || !isAtprotoOAuthPath(url.pathname)) {
        return;
      }
      return {
        response: await router.fetch(request, { authContext: context }),
      };
    },
  };
};
