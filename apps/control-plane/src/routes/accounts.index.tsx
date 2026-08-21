/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { ArrowIcon, PlusIcon } from "../components/icons";
import { Badge } from "../components/ui/badge";
import { buttonVariants } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { accountsQuery } from "../features/accounts/queries";
import type { ManagedAccount } from "../lib/api";

export const Route = createFileRoute("/accounts/")({
  component: AccountsPage,
  loader: ({ context }) => context.queryClient.ensureQueryData(accountsQuery),
});

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));

function AccountRow({ account }: { account: ManagedAccount }) {
  return (
    <Link
      className="account-row"
      params={{ did: account.did }}
      to="/accounts/$did"
    >
      <span className={`account-avatar ${account.accountType}`}>
        {account.handle.slice(0, 2).toUpperCase()}
      </span>
      <span className="account-identity">
        <strong>{account.handle}</strong>
        <code>{account.did}</code>
      </span>
      <Badge
        className="account-type-badge uppercase"
        variant={account.accountType === "human" ? "default" : "secondary"}
      >
        {account.accountType}
      </Badge>
      <span className="account-date">{formatDate(account.createdAt)}</span>
      <ArrowIcon className="row-arrow" />
    </Link>
  );
}

function AccountsPage() {
  const { data: accounts } = useSuspenseQuery(accountsQuery);
  const humans = accounts.filter(({ accountType }) => accountType === "human");
  const agents = accounts.length - humans.length;

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Identity operations</span>
          <h1>Accounts</h1>
          <p>Human and agent identities managed across the private PDS.</p>
        </div>
        <Link
          className={buttonVariants({
            className: "create-account-button",
            size: "lg",
          })}
          to="/accounts/new"
        >
          <PlusIcon />
          Create account
        </Link>
      </div>

      <section className="stats-grid" aria-label="Account summary">
        <Card className="stat-card primary gap-0 py-0">
          <span>Total accounts</span>
          <strong>{accounts.length.toString().padStart(2, "0")}</strong>
          <small>Managed identities</small>
        </Card>
        <Card className="stat-card gap-0 py-0">
          <span>Human</span>
          <strong>{humans.length.toString().padStart(2, "0")}</strong>
          <small>Operator-controlled</small>
        </Card>
        <Card className="stat-card gap-0 py-0">
          <span>Agent</span>
          <strong>{agents.toString().padStart(2, "0")}</strong>
          <small>System-operated</small>
        </Card>
      </section>

      <Card className="accounts-panel gap-0 py-0">
        <div className="panel-heading">
          <div>
            <h2>Managed identities</h2>
            <p>Canonical accounts registered through the PDS.</p>
          </div>
          <Badge variant="outline">{accounts.length} records</Badge>
        </div>

        {accounts.length === 0 ? (
          <div className="empty-state">
            <span className="empty-orbit">
              <span />
            </span>
            <h3>No accounts yet</h3>
            <p>Create the first human or agent identity in this sphere.</p>
            <Link className="text-link" to="/accounts/new">
              Create the first account <ArrowIcon />
            </Link>
          </div>
        ) : (
          <div className="account-list">
            <div className="account-list-header" aria-hidden="true">
              <span>Identity</span>
              <span>Type</span>
              <span>Created</span>
              <span />
            </div>
            {accounts.map((account) => (
              <AccountRow account={account} key={account.did} />
            ))}
          </div>
        )}
      </Card>
    </main>
  );
}
