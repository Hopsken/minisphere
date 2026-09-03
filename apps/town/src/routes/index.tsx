/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import {
  createAuthorizationUrl,
  getSession,
  listStoredSessions,
} from "@atcute/oauth-browser-client";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, LogInIcon } from "lucide-react";
import { useState } from "react";

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
  const [isPending, setIsPending] = useState(false);

  const login = async () => {
    setError(null);
    setIsPending(true);
    try {
      const authorizationUrl = await createAuthorizationUrl({
        scope: configuration.scope,
        target: { serviceUrl: configuration.pdsOrigin, type: "pds" },
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
          <button
            className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-emerald-600 disabled:cursor-wait disabled:opacity-60"
            disabled={isPending}
            onClick={login}
            type="button"
          >
            <LogInIcon className="size-4" aria-hidden="true" />
            {isPending ? "Opening login…" : "Log in with AT Protocol"}
          </button>
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
