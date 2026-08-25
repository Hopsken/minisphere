/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { AppShell } from "@/components/app-shell";

const validationOrigin = "https://minisphere.invalid";

const loginSearchSchema = z.object({
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
  component: LoginPage,
  validateSearch: loginSearchSchema,
});

function LoginPage() {
  return (
    <AppShell user={null}>
      <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
        Sign in required
      </h1>
      <p className="text-muted-foreground mt-3 text-sm">
        You must sign in to view this page.
      </p>
    </AppShell>
  );
}
