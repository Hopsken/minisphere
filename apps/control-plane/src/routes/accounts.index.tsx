/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import { Blobatar } from "@/components/ui/blobatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { accountKeys, accountsQuery } from "@/features/accounts/queries";
import { createAccount } from "@/lib/api";
import type { ManagedAccount } from "@/lib/api";

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
          <h1 className="font-heading text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
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

function AccountItem({ account }: { account: ManagedAccount }) {
  const name = account.handle.split(".", 1)[0] ?? account.handle;

  return (
    <div className="group flex min-w-0 flex-col items-center gap-3">
      <Blobatar
        name={account.did}
        className="size-20 shadow-sm transition-[box-shadow] group-hover:shadow-md sm:size-24"
      />
      <span className="w-full truncate px-1 text-center text-sm font-medium">
        {name}
      </span>
    </div>
  );
}

const accountNamePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

function NewAccountDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const normalizedName = name.trim().toLowerCase();
  const isValid =
    normalizedName.length >= 2 &&
    normalizedName.length <= 63 &&
    accountNamePattern.test(normalizedName);
  const mutation = useMutation({
    mutationFn: createAccount,
    onError: (error) => toast.error(error.message),
    onSuccess: (account) => {
      queryClient.setQueryData<ManagedAccount[]>(
        accountKeys.all,
        (accounts) => [account, ...(accounts ?? [])]
      );
      setName("");
      setOpen(false);
      toast.success(`${normalizedName} was created`);
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (mutation.isPending) {
      return;
    }
    setOpen(nextOpen);
    if (!nextOpen) {
      setName("");
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isValid && !mutation.isPending) {
      mutation.mutate({ name: normalizedName });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            size="icon-lg"
            className="rounded-full shadow-sm"
            aria-label="Add account"
          />
        }
      >
        <PlusIcon className="size-5" strokeWidth={2.25} />
      </DialogTrigger>
      <DialogContent className="max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none">
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
        </DialogHeader>
        <form className="contents" onSubmit={handleSubmit}>
          <label htmlFor="account-name" className="sr-only">
            Account name
          </label>
          <Input
            id="account-name"
            name="name"
            placeholder="account-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={mutation.isPending}
            minLength={2}
            maxLength={63}
            pattern="[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
          />
          <DialogFooter className="mt-auto sm:mt-2">
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                />
              }
            >
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!isValid || mutation.isPending}>
              {mutation.isPending && (
                <LoaderCircleIcon className="size-4 animate-spin" />
              )}
              {mutation.isPending ? "Creating" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
