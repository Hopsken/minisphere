/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { sessionQuery } from "@/features/auth/queries";

export const Route = createFileRoute("/_protected")({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (!session) {
      throw redirect({
        replace: true,
        search: { redirect: location.href },
        to: "/login",
      });
    }

    return { user: session.user };
  },
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { user } = Route.useRouteContext();

  return (
    <AppShell user={user}>
      <Outlet />
    </AppShell>
  );
}
