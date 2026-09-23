/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { RepoPermission } from "@atproto/oauth-scopes";
import { queryOptions } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";

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

// Display names only: adding a label never grants permission or enables a schema.
const collectionLabels = new Map([["app.bsky.feed.post", "Bluesky posts"]]);
const permissionList = new Intl.ListFormat("en", { type: "conjunction" });

const scopeLabel = (scope: string) => {
  if (scope === "atproto") {
    return "Access your AT Protocol account";
  }
  const permission = RepoPermission.fromString(scope);
  if (permission) {
    const actions = permissionList.format(permission.action);
    const targets = permission.collection.map((collection) => {
      if (collection === "*") {
        return "all public records (all collections)";
      }
      const label = collectionLabels.get(collection);
      return label ? `public ${label}` : `public records in ${collection}`;
    });
    return `${actions.charAt(0).toUpperCase()}${actions.slice(1)} ${permissionList.format(targets)}`;
  }
  return `Requested permission: ${scope}`;
};

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
  const { authorization, user } = Route.useRouteContext();
  const { consent_token: consentToken } = Route.useSearch();
  const { clientId, scope, subject } = authorization;
  const label = subject.handle ?? subject.displayName ?? subject.did;
  const clientLabel = clientId.startsWith("http://localhost")
    ? "Local application"
    : clientId;
  const scopes = scope.split(" ").map((value) => ({
    label: scopeLabel(value),
    value,
  }));

  return (
    <section className="flex w-full max-w-md flex-col items-center text-center">
      <h1 className="text-2xl font-semibold">Authorize this app?</h1>
      <p className="text-muted-foreground mt-2 max-w-full text-sm [overflow-wrap:anywhere]">
        {clientLabel}
      </p>

      <UserAvatar className="mt-9 size-18" user={user} />
      <p className="text-primary mt-4 font-semibold">@{label}</p>
      <p className="text-muted-foreground mt-1 max-w-full text-xs [overflow-wrap:anywhere]">
        {subject.did}
      </p>

      <ul className="border-border bg-card mt-8 w-full space-y-2 rounded-2xl border p-4 text-left text-sm [overflow-wrap:anywhere] shadow-xs">
        {scopes.map(({ label: scopeLabelValue, value }) => (
          <li key={value}>{scopeLabelValue}</li>
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
