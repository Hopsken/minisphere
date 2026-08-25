/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: session } = authClient.useSession();
  const user = session?.user ?? null;

  return (
    <AppShell user={user}>
      {user ? (
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          Hi {user.name}
        </h1>
      ) : null}
    </AppShell>
  );
}
