/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before its component declaration. */
import { finalizeAuthorization } from "@atcute/oauth-browser-client";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";

let authorization: Promise<void> | undefined;

const completeAuthorization = () => {
  authorization ??= (async () => {
    if (!window.location.hash) {
      throw new Error("The authorization response is missing");
    }
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    window.history.replaceState(null, "", window.location.pathname);
    await finalizeAuthorization(parameters);
  })();
  return authorization;
};

export const Route = createFileRoute("/oauth/callback")({
  component: CallbackErrorPage,
  loader: async () => {
    try {
      await completeAuthorization();
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Authorization could not be completed",
      };
    }
    throw redirect({ to: "/" });
  },
});

function CallbackErrorPage() {
  const { error } = Route.useLoaderData();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-6 py-12">
      <section className="w-full rounded-3xl border border-red-200 bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-semibold text-stone-950">Login failed</h1>
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
        <Link
          className="mt-6 inline-flex text-sm font-semibold text-emerald-700 hover:underline"
          to="/"
        >
          Return to Town
        </Link>
      </section>
    </main>
  );
}
