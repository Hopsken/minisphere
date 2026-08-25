/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: AccountsHome,
});

function AccountsHome() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="max-w-xl text-center">
        <p className="text-primary mb-3 text-sm font-medium tracking-wide uppercase">
          minisphere
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          Accounts
        </h1>
        <p className="text-muted-foreground mt-4 text-sm leading-6 sm:text-base">
          Authentication UI is not configured yet.
        </p>
      </div>
    </main>
  );
}
