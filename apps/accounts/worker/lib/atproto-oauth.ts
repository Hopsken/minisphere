import { atprotoOAuthProvider } from "@minisphere/atproto-oauth-provider";

import { resolveConfig } from "../config";
import type { Database } from "../db";
import { UserRepository } from "../repositories/user-repository";
import { OAuthSigningKeys } from "../services/oauth-signing-keys";
import { createHostedHandle } from "./hosted-handle";

export const createAtprotoOAuthProvider = (env: Env, database: Database) => {
  const config = resolveConfig(env);
  const users = new UserRepository(database);
  const signingKeys = new OAuthSigningKeys();

  return atprotoOAuthProvider({
    getAccountCompletionUrl: () => "/onboarding/username?oauth=true",
    getAuthorizationPageUrl: (consentToken) =>
      `/authorize?${new URLSearchParams({ consent_token: consentToken }).toString()}`,
    getAuthorizationSubject: async (userId) => {
      const account = await users.findAccountByUserId(userId);
      if (account?.status !== "active" || !account.did) {
        return null;
      }
      return {
        did: account.did,
        displayName: account.username,
        handle: createHostedHandle(account.username, config.handleDomain),
      };
    },
    getJwks: () => signingKeys.getJwks(),
    getLoginUrl: (returnTo) =>
      `/login?${new URLSearchParams({ redirect: returnTo }).toString()}`,
    issueAccessToken: (input) => signingKeys.issueAccessToken(input),
    issuer: config.accountsOrigin,
    resource: config.pdsOrigin,
  });
};
