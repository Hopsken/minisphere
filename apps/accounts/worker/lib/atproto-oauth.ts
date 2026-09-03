import { atprotoOAuthProvider } from "@minisphere/atproto-oauth-provider";

import type { Config } from "../config";
import type { Database } from "../db";
import { UserRepository } from "../repositories/user-repository";
import { createHostedHandle } from "./hosted-handle";
import { createOAuthAccessToken, createOAuthJwks } from "./oauth-access-token";

export const createAtprotoOAuthProvider = (
  config: Config,
  database: Database
) => {
  const users = new UserRepository(database);

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
        handle: createHostedHandle(account.username, config.publicHandleDomain),
      };
    },
    getJwks: () => createOAuthJwks(config.accountsOAuthSigningKey),
    getLoginUrl: (returnTo) =>
      `/login?${new URLSearchParams({ redirect: returnTo }).toString()}`,
    issueAccessToken: (input) =>
      createOAuthAccessToken(input, config.accountsOAuthSigningKey),
    issuer: config.publicUrl,
    resource: config.pdsOrigin,
  });
};
