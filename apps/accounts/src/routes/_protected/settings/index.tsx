/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { accountQuery, plcAccountQuery } from "@/features/account/queries";

import { PdsSettings } from "./-components/pds-settings";

export const Route = createFileRoute("/_protected/settings/")({
  beforeLoad: async ({ context }) => {
    const account = await context.queryClient.fetchQuery(accountQuery);
    if (account.state !== "active") {
      throw redirect({ to: "/onboarding/username" });
    }
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = Route.useRouteContext();
  const plc = useQuery({
    ...plcAccountQuery(user.id),
    refetchOnWindowFocus: false,
  });
  return (
    <section className="w-full">
      <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
      {plc.data ? <PdsSettings record={plc.data} userId={user.id} /> : null}
      {plc.isPending ? (
        <p
          className="text-muted-foreground mt-7 flex items-center gap-2 text-sm"
          role="status"
        >
          <Spinner />
          Reading current endpoint…
        </p>
      ) : null}
      {!plc.data && plc.isError ? (
        <div className="mt-7 space-y-4">
          <p className="text-muted-foreground text-sm" role="alert">
            {plc.error.message}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={plc.isFetching}
            onClick={() => plc.refetch()}
          >
            {plc.isFetching ? <Spinner /> : null}Retry
          </Button>
        </div>
      ) : null}
    </section>
  );
}
