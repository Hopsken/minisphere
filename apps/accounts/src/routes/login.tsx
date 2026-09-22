/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { sessionQuery } from "@/features/auth/queries";

import { DevLoginForm } from "./-components/dev-login-form";
import { EmailLoginForm } from "./-components/email-login-form";

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
  },
  component: LoginPage,
  validateSearch: loginSearchSchema,
});

function LoginPage() {
  const { error, redirect: returnTo } = Route.useSearch();

  return (
    <div className="bg-background flex min-h-dvh flex-col px-6">
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-16 sm:py-24">
        <div className="font-heading mb-12 text-xl font-semibold tracking-tight">
          minisphere
        </div>
        {error ? (
          <p role="alert" className="text-destructive mb-5 text-sm">
            Sign-in could not be completed. Try again.
          </p>
        ) : null}
        <EmailLoginForm returnTo={returnTo} />
      </main>
      {import.meta.env.DEV ? (
        <footer className="mx-auto w-full max-w-sm pb-6">
          <DevLoginForm returnTo={returnTo} />
        </footer>
      ) : null}
    </div>
  );
}
