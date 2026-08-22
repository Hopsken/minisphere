/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/accounts/$did")({
  component: AccountDetailPage,
});

function AccountDetailPage() {
  return null;
}
