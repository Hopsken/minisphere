/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import type { SubmitEvent } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  accountKeys,
  accountQuery,
  usernameAvailabilityQuery,
} from "@/features/account/queries";
import type { Account } from "@/features/account/queries";
import { api } from "@/lib/api";

import { usernameSchema } from "../../../../schema/account";

const onboardingSearchSchema = z.object({
  oauth: z
    .union([z.boolean(), z.literal("true")])
    .optional()
    .transform((value) => value === true || value === "true"),
});

const errorResponseSchema = z.object({ message: z.string().optional() });

export const Route = createFileRoute("/_protected/onboarding/username")({
  beforeLoad: async ({ context, search }) => {
    const account = await context.queryClient.fetchQuery(accountQuery);
    if (account.state === "active") {
      throw redirect({ search: { oauth: search.oauth }, to: "/dashboard" });
    }
    return { account };
  },
  component: UsernameOnboardingPage,
  validateSearch: onboardingSearchSchema,
});

function UsernameStatus({
  available,
  availabilityPending,
  availabilityResolved,
  validationError,
}: {
  available: boolean;
  availabilityPending: boolean;
  availabilityResolved: boolean;
  validationError: string | undefined;
}) {
  if (availabilityPending) {
    return (
      <span className="text-muted-foreground inline-flex items-center gap-1.5">
        <Spinner /> Checking availability
      </span>
    );
  }
  if (available) {
    return (
      <span className="text-primary inline-flex items-center gap-1.5">
        <CircleCheckIcon className="size-4" /> Username is available
      </span>
    );
  }
  if (availabilityResolved) {
    return (
      <span className="text-destructive inline-flex items-center gap-1.5">
        <CircleXIcon className="size-4" /> Username is already taken
      </span>
    );
  }
  if (validationError) {
    return <span className="text-destructive">{validationError}</span>;
  }
  return null;
}

function UsernameOnboardingPage() {
  const initialAccount = Route.useRouteContext().account;
  const { oauth } = Route.useSearch();
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: account = initialAccount } = useQuery(accountQuery);

  const parsedUsername = usernameSchema.safeParse(name);
  const normalizedUsername = parsedUsername.success ? parsedUsername.data : "";
  const deferredUsername = useDeferredValue(normalizedUsername);
  const availability = useQuery(usernameAvailabilityQuery(deferredUsername));

  const mutation = useMutation({
    mutationFn: async (username: string) => {
      const response = await api.account.$post({ json: { username } });
      if (!response.ok) {
        const parsed = errorResponseSchema.safeParse(await response.json());
        throw new Error(
          parsed.success && parsed.data.message
            ? parsed.data.message
            : "Could not create your account"
        );
      }
      return response.json();
    },
    onSuccess: async (result) => {
      queryClient.setQueryData<Account>(accountKeys.account, result);
      if (result.state === "active") {
        await navigate({
          replace: true,
          search: { oauth },
          to: "/dashboard",
        });
      }
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      normalizedUsername &&
      availability.data?.available &&
      !mutation.isPending
    ) {
      mutation.mutate(normalizedUsername);
    }
  };

  if (account.state === "provisioning") {
    return (
      <section className="flex w-full max-w-md flex-col items-center text-center">
        <Spinner className="text-primary size-10" />
        <h1 className="mt-6 text-2xl font-semibold">Creating your account</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          We have reserved <strong>@{account.handle}</strong>. If creation was
          interrupted, retrying will continue the same operation and will not
          create a second identity.
        </p>
        {mutation.error ? (
          <p className="text-destructive mt-4 text-sm">
            {mutation.error.message}
          </p>
        ) : null}
        <Button
          className="mt-7"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(account.username)}
        >
          {mutation.isPending ? <Spinner /> : null}
          {mutation.isPending ? "Checking status" : "Retry safely"}
        </Button>
      </section>
    );
  }

  const availabilityPending =
    Boolean(normalizedUsername) &&
    (availability.isFetching || deferredUsername !== normalizedUsername);
  const available =
    deferredUsername === normalizedUsername &&
    availability.data?.available === true;

  return (
    <section className="w-full max-w-md">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">Choose your username</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          This creates your permanent hosted handle and AT Protocol identity.
        </p>
      </div>
      <form className="mt-8" onSubmit={submit}>
        <label className="mb-2 block text-sm font-medium" htmlFor="username">
          Username
        </label>
        <div className="border-input bg-input/50 focus-within:border-ring focus-within:ring-ring/30 flex h-11 items-center rounded-3xl border focus-within:ring-3">
          <Input
            aria-describedby="username-status username-help"
            aria-invalid={Boolean(name && !parsedUsername.success)}
            autoCapitalize="none"
            autoComplete="username"
            className="h-full flex-1 border-0 bg-transparent focus-visible:ring-0"
            disabled={mutation.isPending}
            id="username"
            maxLength={63}
            minLength={2}
            name="username"
            onChange={(event) => setName(event.target.value)}
            placeholder="username"
            spellCheck={false}
            value={name}
          />
          <span className="text-muted-foreground pr-4 text-sm">
            .{account.handleDomain}
          </span>
        </div>
        <div className="mt-2 min-h-5 text-sm" id="username-status">
          <UsernameStatus
            available={available}
            availabilityPending={availabilityPending}
            availabilityResolved={Boolean(
              normalizedUsername && availability.data
            )}
            validationError={
              name && !parsedUsername.success
                ? parsedUsername.error.issues[0]?.message
                : undefined
            }
          />
        </div>
        <p className="text-muted-foreground mt-4 text-xs" id="username-help">
          Use lowercase letters, numbers, and interior hyphens. Your username
          and DID cannot be changed or reassigned after creation.
        </p>
        {mutation.error ? (
          <p className="text-destructive mt-4 text-sm">
            {mutation.error.message}
          </p>
        ) : null}
        <Button
          className="mt-7 w-full"
          disabled={!available || mutation.isPending}
          size="lg"
          type="submit"
        >
          {mutation.isPending ? <Spinner /> : null}
          {mutation.isPending ? "Creating account" : "Create account"}
        </Button>
      </form>
    </section>
  );
}
