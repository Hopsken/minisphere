/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { Card, CardContent } from "@/components/ui/card";
import { accountsQuery } from "@/features/accounts/queries";

import { AccountItem } from "./-components/account-item";
import { NewAccountDialog } from "./-components/new-account-dialog";

export const Route = createFileRoute("/accounts/")({
  component: AccountsPage,
  loader: ({ context }) => context.queryClient.ensureQueryData(accountsQuery),
});

function AccountsPage() {
  const { data: accounts } = useSuspenseQuery(accountsQuery);

  return (
    <div className="bg-background min-h-dvh">
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-6 sm:py-10 lg:py-14">
        <header className="mb-6 flex items-center justify-between px-1 sm:mb-8 sm:px-2">
          <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
            minisphere
          </h1>
          <NewAccountDialog />
        </header>

        <Card
          aria-label="Accounts"
          role="region"
          className="min-h-56 gap-0 py-8 sm:py-10"
        >
          <CardContent className="px-4 sm:px-8">
            {accounts.length > 0 ? (
              <div className="grid grid-cols-3 gap-x-3 gap-y-8 sm:grid-cols-4 sm:gap-x-6 sm:gap-y-10 lg:grid-cols-6">
                {accounts.map((account) => (
                  <AccountItem key={account.did} account={account} />
                ))}
              </div>
            ) : (
              <div className="text-muted-foreground flex min-h-36 items-center justify-center text-sm">
                No accounts yet
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
