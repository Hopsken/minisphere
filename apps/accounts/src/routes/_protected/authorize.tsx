/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { queryOptions } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

const authorizationSearchSchema = z.object({
  consent_token: z.string().min(1),
});

const authorizationDetailsSchema = z.object({
  clientId: z.string(),
  scope: z.string(),
  subject: z.object({
    did: z.string(),
    displayName: z.string().optional(),
    handle: z.string().optional(),
  }),
});

const authorizationDetailsQuery = (consentToken: string) =>
  queryOptions({
    queryFn: async () => {
      const parameters = new URLSearchParams({ consent_token: consentToken });
      const response = await fetch(
        `/oauth/authorization-details?${parameters.toString()}`
      );
      if (!response.ok) {
        throw new Error("Authorization request is invalid or has expired");
      }
      return authorizationDetailsSchema.parse(await response.json());
    },
    queryKey: ["oauth", "authorization", consentToken] as const,
    staleTime: 0,
  });

export const Route = createFileRoute("/_protected/authorize")({
  beforeLoad: async ({ context, search }) => ({
    authorization: await context.queryClient.fetchQuery(
      authorizationDetailsQuery(search.consent_token)
    ),
  }),
  component: AuthorizationPage,
  validateSearch: authorizationSearchSchema,
});

function AuthorizationPage() {
  const { authorization } = Route.useRouteContext();
  const { consent_token: consentToken } = Route.useSearch();
  const { clientId, scope, subject } = authorization;
  const label = subject.handle ?? subject.displayName ?? subject.did;
  const clientLabel = clientId.startsWith("http://localhost")
    ? "Local application"
    : clientId;
  const scopes = scope
    .split(" ")
    .map((value) =>
      value === "atproto"
        ? "Access your AT Protocol account"
        : value.replaceAll(/[:_-]+/gu, " ")
    );

  return (
    <section className="flex w-full max-w-md flex-col items-center text-center">
      <h1 className="text-2xl font-semibold">Authorize this app?</h1>
      <p className="text-muted-foreground mt-2 max-w-full text-sm [overflow-wrap:anywhere]">
        {clientLabel}
      </p>

      <Avatar className="mt-9 size-18">
        <AvatarFallback className="text-primary bg-primary/10 text-xl font-semibold">
          {label.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <p className="text-primary mt-4 font-semibold">@{label}</p>
      <p className="text-muted-foreground mt-1 max-w-full text-xs [overflow-wrap:anywhere]">
        {subject.did}
      </p>

      <ul className="border-border bg-card mt-8 w-full rounded-2xl border p-4 text-left text-sm shadow-xs">
        {scopes.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>

      <form
        action="/oauth/authorize"
        className="mt-7 flex w-full gap-3"
        method="post"
      >
        <input name="consent_token" type="hidden" value={consentToken} />
        <Button
          className="flex-1"
          name="decision"
          type="submit"
          value="deny"
          variant="outline"
        >
          Cancel
        </Button>
        <Button className="flex-1" name="decision" type="submit" value="allow">
          Authorize
        </Button>
      </form>
    </section>
  );
}
