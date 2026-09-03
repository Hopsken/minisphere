/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { LogInIcon } from "lucide-react";
import { z } from "zod";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { sessionQuery } from "@/features/auth/queries";
import { configurationQuery } from "@/features/configuration/queries";
import { authClient } from "@/lib/auth-client";

import { DevLoginForm } from "./-components/dev-login-form";

const validationOrigin = "https://minisphere.invalid";

const loginSearchSchema = z.object({
  error: z.string().optional(),
  redirect: z
    .string()
    .optional()
    .transform((path) => {
      if (!path?.startsWith("/") || path.startsWith("//")) {
        return "/";
      }

      try {
        return new URL(path, validationOrigin).origin === validationOrigin
          ? path
          : "/";
      } catch {
        return "/";
      }
    }),
});

export const Route = createFileRoute("/login")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery(sessionQuery);
    if (session) {
      throw redirect({ to: "/" });
    }
    return {
      configuration: await context.queryClient.fetchQuery(configurationQuery),
    };
  },
  component: LoginPage,
  validateSearch: loginSearchSchema,
});

function LoginPage() {
  const { error, redirect: returnTo } = Route.useSearch();
  const { configuration } = Route.useRouteContext();
  const signIn = useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.social({
        callbackURL: returnTo,
        provider: "oidc",
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Sign-in failed");
      }
    },
  });

  return (
    <AppShell user={null}>
      <section className="flex w-full max-w-sm flex-1 flex-col items-center justify-center pb-20 text-center">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Welcome
        </h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Sign in to continue to minisphere.
        </p>
        {error || signIn.error ? (
          <p className="text-destructive mt-5 text-sm">
            {signIn.error?.message ??
              "Sign-in could not be completed. Try again."}
          </p>
        ) : null}
        <Button
          className="mt-7 min-w-56"
          disabled={signIn.isPending}
          onClick={() => signIn.mutate()}
          size="lg"
        >
          {signIn.isPending ? <Spinner /> : <LogInIcon />}
          {signIn.isPending
            ? "Opening sign-in"
            : `Continue with ${configuration.oidcProviderName}`}
        </Button>
      </section>
      {import.meta.env.DEV ? <DevLoginForm returnTo={returnTo} /> : null}
    </AppShell>
  );
}
