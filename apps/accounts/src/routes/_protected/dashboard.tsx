/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = Route.useRouteContext();

  return (
    <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
      Hi {user.name}
    </h1>
  );
}
