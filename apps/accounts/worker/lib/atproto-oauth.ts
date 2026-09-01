import { atprotoOAuthProvider } from "@minisphere/atproto-oauth-provider";
import type { AtprotoAuthorizationPageInput } from "@minisphere/atproto-oauth-provider";

import type { Database } from "../db";
import { UserRepository } from "../repositories/user-repository";

const escapeHtml = (value: string) =>
  value.replaceAll(/[&<>"']/gu, (character) => {
    const entities = new Map([
      ['"', "&quot;"],
      ["&", "&amp;"],
      ["'", "&#39;"],
      ["<", "&lt;"],
      [">", "&gt;"],
    ]);
    return entities.get(character) ?? character;
  });

const renderAuthorizationPage = ({
  clientId,
  consentToken,
  scope,
  subjects,
}: AtprotoAuthorizationPageInput) => {
  const subjectForms = subjects
    .map((subject) => {
      const label = subject.handle ?? subject.displayName ?? subject.did;
      return `<form action="/oauth/authorize" method="post">
        <input name="consent_token" type="hidden" value="${escapeHtml(consentToken)}">
        <input name="decision" type="hidden" value="allow">
        <input name="did" type="hidden" value="${escapeHtml(subject.did)}">
        <button type="submit">Continue as ${escapeHtml(label)}</button>
        <small>${escapeHtml(subject.did)}</small>
      </form>`;
    })
    .join("");

  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize AT Protocol client</title>
    <style>
      body { color: #172033; font: 16px system-ui, sans-serif; margin: 4rem auto; max-width: 42rem; padding: 0 1rem; }
      main, form { display: grid; gap: 0.75rem; }
      form { border-top: 1px solid #d7dce5; padding-top: 1rem; }
      button { cursor: pointer; font: inherit; padding: 0.7rem 1rem; }
      small { overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorize an AT Protocol client</h1>
      <p><strong>${escapeHtml(clientId)}</strong> requests <code>${escapeHtml(scope)}</code>.</p>
      ${subjectForms || "<p>You do not have an AT Protocol identity that matches this request.</p>"}
      <form action="/oauth/authorize" method="post">
        <input name="consent_token" type="hidden" value="${escapeHtml(consentToken)}">
        <input name="decision" type="hidden" value="deny">
        <button type="submit">Deny</button>
      </form>
    </main>
  </body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
};

export const createAtprotoOAuthProvider = (env: Env, database: Database) => {
  const users = new UserRepository(database);

  return atprotoOAuthProvider({
    getAuthorizationSubjects: async (userId) => {
      const accounts = await users.listManagedAccounts(userId);
      return accounts.flatMap((account) =>
        account.did
          ? [
              account.username
                ? {
                    did: account.did,
                    displayName: account.username,
                    handle: `${account.username}.${env.PUBLIC_HANDLE_DOMAIN}`,
                  }
                : { did: account.did },
            ]
          : []
      );
    },
    getLoginUrl: (returnTo) =>
      `/login?${new URLSearchParams({ redirect: returnTo }).toString()}`,
    isAuthorizedSubject: async (userId, did) => {
      const accounts = await users.listManagedAccounts(userId);
      return accounts.some((account) => account.did === did);
    },
    issueAccessToken: (input) => env.PDS.issueOAuthAccessToken(input),
    issuer: env.PUBLIC_URL,
    renderAuthorizationPage,
    resource: env.PDS_ORIGIN,
  });
};
