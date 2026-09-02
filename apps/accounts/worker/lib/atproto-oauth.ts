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
  subject,
}: AtprotoAuthorizationPageInput) => {
  const label = subject.handle ?? subject.displayName ?? subject.did;
  const clientLabel = clientId.startsWith("http://localhost")
    ? "Local application"
    : clientId;
  const scopeLabels = scope
    .split(" ")
    .map((value) =>
      value === "atproto"
        ? "Access your AT Protocol account"
        : value.replaceAll(/[:_-]+/gu, " ")
    )
    .map((value) => `<li>${escapeHtml(value)}</li>`)
    .join("");

  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize ${escapeHtml(clientId)}</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { background: #f7f7f5; color: #191919; margin: 0; min-height: 100vh; padding: 12px; }
      header, main { margin: 0 auto; max-width: 34rem; }
      header { align-items: center; background: white; border: 1px solid #e5e5e2; border-radius: 14px; display: flex; font-weight: 650; height: 52px; justify-content: space-between; padding: 0 16px; }
      .avatar { align-items: center; background: #e8e8e5; border-radius: 999px; display: flex; height: 32px; justify-content: center; width: 32px; }
      main { align-items: center; display: flex; flex-direction: column; padding: 56px 20px 24px; text-align: center; }
      h1 { font-size: 1.5rem; margin: 0 0 8px; }
      .client { color: #666; margin: 0 0 32px; overflow-wrap: anywhere; }
      .subject-avatar { align-items: center; background: #e8f3ee; border-radius: 999px; color: #176544; display: flex; font-size: 1.5rem; font-weight: 650; height: 72px; justify-content: center; width: 72px; }
      .handle { color: #176544; font-weight: 650; margin: 16px 0 4px; }
      .did { color: #777; font-size: .82rem; margin: 0; overflow-wrap: anywhere; }
      ul { background: white; border: 1px solid #e5e5e2; border-radius: 14px; list-style: none; margin: 28px 0; padding: 16px; text-align: left; width: 100%; }
      li + li { margin-top: 8px; }
      form { display: flex; gap: 10px; justify-content: center; }
      button { border: 1px solid #d8d8d4; border-radius: 999px; cursor: pointer; font: inherit; font-weight: 600; min-width: 110px; padding: 10px 18px; }
      button[value="allow"] { background: #176544; border-color: #176544; color: white; }
    </style>
  </head>
  <body>
    <header><span>minisphere</span><span class="avatar">${escapeHtml(label.charAt(0).toUpperCase())}</span></header>
    <main>
      <h1>Authorize this app?</h1>
      <p class="client">${escapeHtml(clientLabel)}</p>
      <div class="subject-avatar">${escapeHtml(label.charAt(0).toUpperCase())}</div>
      <p class="handle">@${escapeHtml(label)}</p>
      <p class="did">${escapeHtml(subject.did)}</p>
      <ul>${scopeLabels}</ul>
      <form action="/oauth/authorize" method="post">
        <input name="consent_token" type="hidden" value="${escapeHtml(consentToken)}">
        <button name="decision" type="submit" value="deny">Cancel</button>
        <button name="decision" type="submit" value="allow">Authorize</button>
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
    getAccountCompletionUrl: () => "/onboarding/username?oauth=true",
    getAuthorizationSubject: async (userId) => {
      const account = await users.findAccountByUserId(userId);
      if (account?.status !== "active" || !account.did) {
        return null;
      }
      return {
        did: account.did,
        displayName: account.username,
        handle: `${account.username}.${env.PUBLIC_HANDLE_DOMAIN}`,
      };
    },
    getLoginUrl: (returnTo) =>
      `/login?${new URLSearchParams({ redirect: returnTo }).toString()}`,
    issueAccessToken: (input) => env.PDS.issueOAuthAccessToken(input),
    issuer: env.PUBLIC_URL,
    renderAuthorizationPage,
    resource: env.PDS_ORIGIN,
  });
};
