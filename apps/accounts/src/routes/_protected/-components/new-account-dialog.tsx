/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { InferRequestType } from "hono";
import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import type { SubmitEvent } from "react";
import { toast } from "sonner";
import z from "zod";

import { Button } from "@/components/ui/button";
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
import { didAccountsKeys } from "@/features/did-accounts/queries";
import type { DidAccount } from "@/features/did-accounts/queries";
import { api } from "@/lib/api";

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u, {
    message: "Use lowercase letters, numbers, and interior hyphens",
  });

export const NewAccountDialog = () => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const queryClient = useQueryClient();
  const normalizedName = name.trim().toLowerCase();
  const isValid = z.safeParse(usernameSchema, normalizedName).success;

  const mutation = useMutation({
    mutationFn: async (
      arg: InferRequestType<typeof api.accounts.atproto.$post>
    ) => {
      const response = await api.accounts.atproto.$post(arg);
      return response.json();
    },
    onSuccess: (account) => {
      queryClient.setQueryData<DidAccount[]>(
        didAccountsKeys.list,
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

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isValid && !mutation.isPending) {
      mutation.mutate({ json: { username: normalizedName } });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            size="icon-lg"
            className="rounded-full"
            aria-label="Add account"
            variant={"ghost"}
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
};
