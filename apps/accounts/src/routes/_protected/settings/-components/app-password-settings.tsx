import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, PlusIcon } from "lucide-react";
import { useId, useState } from "react";
import type { SubmitEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { accountKeys, appPasswordsQuery } from "@/features/account/queries";
import type { AppPassword } from "@/features/account/queries";
import { api } from "@/lib/api";

import { createAppPasswordSchema } from "../../../../../schema/app-password";
import type { CreateAppPassword } from "../../../../../schema/app-password";

const errorSchema = z.object({ message: z.string() });

const errorMessage = async (
  response: Pick<Response, "json">,
  fallback: string
) => {
  const parsed = errorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.message : fallback;
};

const CreateDialog = ({
  handle,
  userId,
}: {
  handle: string;
  userId: string;
}) => {
  const queryClient = useQueryClient();
  const nameId = useId();
  const privilegedId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [privileged, setPrivileged] = useState(false);
  const [copied, setCopied] = useState(false);
  const mutation = useMutation({
    mutationFn: async (input: CreateAppPassword) => {
      const response = await api.account["app-passwords"].$post({
        json: input,
      });
      if (!response.ok) {
        throw new Error(
          await errorMessage(response, "Could not create the app password.")
        );
      }
      return response.json();
    },
    // The dialog shows the error inline instead of the global toast.
    onError: () => null,
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: accountKeys.appPasswords(userId),
      }),
  });
  const parsed = createAppPasswordSchema.safeParse({ name, privileged });
  const created = mutation.data;

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setName("");
      setPrivileged(false);
      setCopied(false);
      mutation.reset();
    }
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (parsed.success && !mutation.isPending) {
      mutation.mutate(parsed.data);
    }
  };

  const copy = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      toast.error("Copy failed. Select the password and copy it manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button className="mt-5" />}>
        <PlusIcon aria-hidden="true" />
        Create app password
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{created.name}</DialogTitle>
              <DialogDescription>
                Copy this password now. You won’t see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="bg-muted flex items-center justify-between gap-3 rounded-2xl py-2 pr-2 pl-4">
              <code className="font-mono text-base tracking-wide select-all">
                {created.password}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={copied ? "Copied" : "Copy password"}
                onClick={() => copy(created.password)}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </div>
            <p className="text-muted-foreground">
              Sign in with <strong className="text-foreground">{handle}</strong>{" "}
              and this password.
            </p>
            <DialogFooter>
              <DialogClose render={<Button />}>Done</DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form className="grid gap-6" onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>New app password</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor={nameId}>Name</Label>
              <Input
                id={nameId}
                autoComplete="off"
                placeholder="Bluesky on my phone"
                value={name}
                maxLength={64}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id={privilegedId}
                checked={privileged}
                onCheckedChange={setPrivileged}
              />
              <div className="grid gap-1.5">
                <Label htmlFor={privilegedId}>Allow direct messages</Label>
                <p className="text-muted-foreground text-sm">
                  Lets the app read and send your messages.
                </p>
              </div>
            </div>
            {mutation.error ? (
              <p className="text-destructive text-sm" role="alert">
                {mutation.error.message}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="submit"
                disabled={!parsed.success || mutation.isPending}
              >
                {mutation.isPending ? <Spinner /> : null}
                Create
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

const RevokeDialog = ({
  appPassword,
  userId,
}: {
  appPassword: AppPassword;
  userId: string;
}) => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await api.account["app-passwords"][":id"].$delete({
        param: { id: appPassword.id },
      });
      if (!response.ok) {
        throw new Error(
          await errorMessage(response, "Could not revoke the app password.")
        );
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: accountKeys.appPasswords(userId),
      });
      toast.success(`Revoked ${appPassword.name}.`);
    },
  });
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        Revoke
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke {appPassword.name}?</DialogTitle>
          <DialogDescription>
            Apps using this password will be signed out within five minutes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Spinner /> : null}
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export const AppPasswordSettings = ({
  handle,
  userId,
}: {
  handle: string;
  userId: string;
}) => {
  const appPasswords = useQuery(appPasswordsQuery(userId));
  return (
    <section className="mt-10" aria-labelledby="app-passwords-heading">
      <h2 id="app-passwords-heading" className="text-base font-medium">
        App passwords
      </h2>
      <p className="text-muted-foreground mt-2 text-sm">
        Sign in to Bluesky and other apps that ask for a password.
      </p>
      {appPasswords.isPending ? (
        <p className="text-muted-foreground mt-5 flex items-center gap-2 text-sm">
          <Spinner />
          Loading…
        </p>
      ) : null}
      {appPasswords.data?.length ? (
        <ul className="divide-border border-border mt-5 divide-y border-y">
          {appPasswords.data.map((appPassword) => (
            <li
              key={appPassword.id}
              className="flex items-center justify-between gap-4 py-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{appPassword.name}</p>
                <p className="text-muted-foreground mt-1 text-sm">
                  Created {dateFormat.format(new Date(appPassword.createdAt))}
                  {appPassword.privileged ? " · Direct messages allowed" : ""}
                </p>
              </div>
              <RevokeDialog appPassword={appPassword} userId={userId} />
            </li>
          ))}
        </ul>
      ) : null}
      <CreateDialog handle={handle} userId={userId} />
    </section>
  );
};
