/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { accountQuery } from "@/features/account/queries";

const dashboardSearchSchema = z.object({
  oauth: z
    .union([z.boolean(), z.literal("true")])
    .optional()
    .transform((value) => value === true || value === "true"),
});

export const Route = createFileRoute("/_protected/dashboard")({
  beforeLoad: async ({ context }) => {
    const account = await context.queryClient.fetchQuery(accountQuery);
    if (account.state !== "active") {
      throw redirect({ to: "/onboarding/username" });
    }
    return { account };
  },
  component: DashboardPage,
  validateSearch: dashboardSearchSchema,
});

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const { account } = Route.useRouteContext();
  const { oauth } = Route.useSearch();

  return (
    <section className="flex w-full flex-col items-center text-center">
      {oauth ? (
        <div className="border-primary/20 bg-primary/5 mb-10 w-full rounded-2xl border px-4 py-3 text-left text-sm">
          Your account is ready. Return to your app and start sign-in again.
        </div>
      ) : null}
      <Avatar className="size-20">
        {user.image ? <AvatarImage src={user.image} alt="" /> : null}
        <AvatarFallback className="text-xl">
          {account.username.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <h1 className="text-primary mt-5 text-lg font-semibold">
        @{account.handle}
      </h1>
      <p className="text-muted-foreground mt-1 max-w-full text-sm [overflow-wrap:anywhere]">
        DID: {account.did}
      </p>
    </section>
  );
}
