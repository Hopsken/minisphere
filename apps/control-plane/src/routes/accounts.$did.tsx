/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { ShieldIcon } from "../components/icons";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import { accountQuery } from "../features/accounts/queries";

export const Route = createFileRoute("/accounts/$did")({
  component: AccountDetailPage,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(accountQuery(params.did)),
});

function AccountDetailPage() {
  const { did } = Route.useParams();
  const { data: account } = useSuspenseQuery(accountQuery(did));

  return (
    <main className="page narrow-page">
      <div className="breadcrumb">
        <Link to="/accounts">Accounts</Link>
        <span>/</span>
        <span>{account.handle}</span>
      </div>

      <div className="identity-hero">
        <span className={`account-avatar large ${account.accountType}`}>
          {account.handle.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <Badge
            className="uppercase"
            variant={account.accountType === "human" ? "default" : "secondary"}
          >
            {account.accountType}
          </Badge>
          <h1>{account.handle}</h1>
          <code>{account.did}</code>
        </div>
      </div>

      <div className="detail-grid">
        <Card className="detail-panel gap-0 py-0">
          <div className="panel-heading">
            <div>
              <h2>Account record</h2>
              <p>Canonical identity information returned by the PDS.</p>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>DID</dt>
              <dd>
                <code>{account.did}</code>
              </dd>
            </div>
            <div>
              <dt>Handle</dt>
              <dd>{account.handle}</dd>
            </div>
            <div>
              <dt>PDS origin</dt>
              <dd>{account.pdsOrigin}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{new Date(account.createdAt).toLocaleString()}</dd>
            </div>
          </dl>
        </Card>

        <Card className="security-card gap-0 py-0">
          <ShieldIcon />
          <span className="eyebrow">Key custody</span>
          <h2>Account credentials are encrypted.</h2>
          <p>
            Password, session, and private PLC recovery key are retained by the
            Control Plane and never exposed through the dashboard API.
          </p>
        </Card>
      </div>
    </main>
  );
}
