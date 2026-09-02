import { atprotoOAuthProvider } from "@minisphere/atproto-oauth-provider";

import type { Database } from "../db";
import { UserRepository } from "../repositories/user-repository";
import { createHostedHandle } from "./hosted-handle";
import { createOAuthAccessToken, createOAuthJwks } from "./oauth-access-token";

export const createAtprotoOAuthProvider = (env: Env, database: Database) => {
  const users = new UserRepository(database);

  return atprotoOAuthProvider({
    getAccountCompletionUrl: () => "/onboarding/username?oauth=true",
    getAuthorizationPageUrl: (consentToken) =>
      `/authorize?${new URLSearchParams({ consent_token: consentToken }).toString()}`,
    getJwks: () => createOAuthJwks(env.ACCOUNTS_OAUTH_SIGNING_KEY),
    getAuthorizationSubject: async (userId) => {
      const account = await users.findAccountByUserId(userId);
      if (account?.status !== "active" || !account.did) {
        return null;
      }
      return {
        did: account.did,
        displayName: account.username,
        handle: createHostedHandle(account.username, env.PUBLIC_HANDLE_DOMAIN),
      };
    },
    getLoginUrl: (returnTo) =>
      `/login?${new URLSearchParams({ redirect: returnTo }).toString()}`,
    issueAccessToken: (input) =>
      createOAuthAccessToken(input, env.ACCOUNTS_OAUTH_SIGNING_KEY),
    issuer: env.PUBLIC_URL,
    resource: env.PDS_ORIGIN,
  });
};
