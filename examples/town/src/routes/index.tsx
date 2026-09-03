import { isHandle } from "@atcute/lexicons/syntax";
/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import {
  createAuthorizationUrl,
  getSession,
  listStoredSessions,
} from "@atcute/oauth-browser-client";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, LogInIcon } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { api } from "@/lib/api";

export const Route = createFileRoute("/")({
  component: TownPage,
  loader: async () => {
    const [did] = listStoredSessions();
    if (!did) {
      return { identity: null };
    }

    const session = await getSession(did);
    const response = await api.identities[":did"].$get({
      param: { did: session.info.sub },
    });
    if (!response.ok) {
      throw new Error("The signed-in handle could not be resolved");
    }
    return { identity: await response.json() };
  },
});

function TownPage() {
  const { configuration } = Route.useRouteContext();
  const { identity } = Route.useLoaderData();
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [isPending, setIsPending] = useState(false);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const identifier = handle.trim().toLowerCase().replace(/^@/u, "");
    if (!isHandle(identifier)) {
      setError("Enter a valid handle");
      return;
    }

    setIsPending(true);
    try {
      const authorizationUrl = await createAuthorizationUrl({
        scope: configuration.scope,
        target: { identifier, type: "account" },
      });
      window.location.assign(authorizationUrl);
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : "Login failed"
      );
      setIsPending(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-6 py-12">
      <section className="w-full rounded-3xl border border-stone-300/70 bg-white/80 p-8 shadow-xl shadow-stone-300/30 backdrop-blur sm:p-10">
        <p className="text-xs font-semibold tracking-[0.24em] text-emerald-700 uppercase">
          Minisphere
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-950">
          Town
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          A minimal AT Protocol OAuth client.
        </p>

        {identity ? (
          <div className="mt-8 flex items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-4 text-emerald-950 ring-1 ring-emerald-200">
            <span className="flex size-9 items-center justify-center rounded-full bg-emerald-600 text-white">
              <CheckIcon className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-medium text-emerald-700">Signed in</p>
              <p className="mt-0.5 font-semibold">@{identity.handle}</p>
            </div>
          </div>
        ) : (
          <form className="mt-8" onSubmit={login}>
            <label
              className="text-sm font-medium text-stone-800"
              htmlFor="handle"
            >
              Handle
            </label>
            <input
              autoCapitalize="none"
              autoComplete="username"
              className="mt-2 h-11 w-full rounded-xl border border-stone-300 bg-white px-4 text-sm transition outline-none placeholder:text-stone-400 focus:border-emerald-600 focus:ring-3 focus:ring-emerald-100 disabled:cursor-wait disabled:opacity-60"
              disabled={isPending}
              id="handle"
              name="handle"
              onChange={(event) => setHandle(event.target.value)}
              placeholder="alice.r2d2.party"
              required
              spellCheck={false}
              type="text"
              value={handle}
            />
            <button
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-emerald-600 disabled:cursor-wait disabled:opacity-60"
              disabled={isPending}
              type="submit"
            >
              <LogInIcon className="size-4" aria-hidden="true" />
              {isPending ? "Opening login…" : "Continue"}
            </button>
          </form>
        )}

        {error ? (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
