/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { isDid, isHandle } from "@atcute/lexicons/syntax";
import { createAuthorizationUrl } from "@atcute/oauth-browser-client";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";

import { loadAccount } from "@/lib/account";

import { AccountMenu } from "./-components/account-menu";
import { PostComposer } from "./-components/post-composer";

export const Route = createFileRoute("/")({
  component: TownPage,
  loader: async () => {
    try {
      return { account: await loadAccount(), error: null };
    } catch {
      return {
        account: null,
        error: "Your session could not be loaded. Sign in again.",
      };
    }
  },
});

function TownPage() {
  const { configuration } = Route.useRouteContext();
  const { account: loadedAccount, error: initialError } = Route.useLoaderData();
  const [signedOut, setSignedOut] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const account = signedOut ? null : loadedAccount;
  const [message, setError] = useState<string | null>(initialError);
  const [handle, setHandle] = useState("");
  const [isPending, setIsPending] = useState(false);

  const logout = async () => {
    if (!account || loggingOut) {
      return;
    }
    setLoggingOut(true);
    setError(null);
    try {
      await account.oauth.signOut();
    } catch {
      // signOut removes the local session even if it cannot load or revoke it.
    } finally {
      setSignedOut(true);
      setLoggingOut(false);
    }
  };

  const authorize = async (value: string) => {
    setError(null);
    const identifier = value.trim().replace(/^@/u, "");
    const accountIdentifier = isDid(identifier)
      ? identifier
      : identifier.toLowerCase();
    if (
      !isDid(accountIdentifier) &&
      !isHandle(accountIdentifier) &&
      !identifier.startsWith("https://")
    ) {
      setError("Enter a valid handle, DID, or HTTPS PDS URL.");
      return;
    }
    setIsPending(true);
    try {
      const authorizationUrl = await createAuthorizationUrl({
        prompt: "consent",
        scope: configuration.scope,
        target:
          isDid(accountIdentifier) || isHandle(accountIdentifier)
            ? { identifier: accountIdentifier, type: "account" }
            : { serviceUrl: identifier, type: "pds" },
      });
      window.location.assign(authorizationUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Login failed");
      setIsPending(false);
    }
  };

  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isPending) {
      void authorize(handle);
    }
  };

  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl border-x border-gray-200 bg-white">
      <header className="flex h-20 items-center justify-between border-b border-gray-200 px-5 sm:px-6">
        <h1 className="text-3xl font-bold tracking-tight">Town</h1>
        {account ? (
          <AccountMenu
            account={account}
            onLogout={() => {
              void logout();
            }}
            pending={loggingOut}
          />
        ) : null}
      </header>
      {loggingOut ? (
        <p className="p-6 text-sm text-gray-500" role="status">
          Logging out…
        </p>
      ) : null}
      {account && !loggingOut ? (
        <PostComposer
          account={account}
          authorize={() => {
            if (!isPending) {
              void authorize(account.did);
            }
          }}
        />
      ) : null}
      {account ? null : (
        <form className="p-6" onSubmit={login}>
          <label className="text-sm font-medium" htmlFor="handle">
            Handle or DID
          </label>
          <input
            autoCapitalize="none"
            autoComplete="username"
            className="mt-2 h-12 w-full rounded-xl border border-gray-300 px-4 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
            disabled={isPending}
            id="handle"
            onChange={(event) => setHandle(event.target.value)}
            placeholder="you.bsky.social"
            required
            spellCheck={false}
            value={handle}
          />
          <button
            className="post-button mt-4"
            disabled={isPending}
            type="submit"
          >
            {isPending ? "Opening login…" : "Continue"}
          </button>
        </form>
      )}
      {message ? (
        <p className="px-6 py-4 text-sm text-red-700" role="alert">
          {message}
        </p>
      ) : null}
    </main>
  );
}
