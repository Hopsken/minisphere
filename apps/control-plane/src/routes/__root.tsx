/* oxlint-disable eslint/func-style, eslint/no-use-before-define -- TanStack file routes export Route before their component declarations. */
import type { QueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router";

import { AccountsIcon, ShieldIcon } from "../components/icons";
import { Button, buttonVariants } from "../components/ui/button";
import { Card } from "../components/ui/card";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: ({ error, reset }) => (
    <main className="centered-state">
      <Card className="state-card gap-0 py-0">
        <span className="eyebrow">Something went wrong</span>
        <h1>Control Plane could not load this view.</h1>
        <p>{error.message}</p>
        <Button onClick={reset} size="lg" type="button">
          Try again
        </Button>
      </Card>
    </main>
  ),
  notFoundComponent: () => (
    <main className="centered-state">
      <Card className="state-card gap-0 py-0">
        <span className="eyebrow">404</span>
        <h1>This route is outside the sphere.</h1>
        <Link className={buttonVariants({ size: "lg" })} to="/accounts">
          Return to accounts
        </Link>
      </Card>
    </main>
  ),
});

function RootLayout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/accounts" aria-label="Minisphere accounts">
          <span className="brand-mark">
            <span />
          </span>
          <span>
            <strong>minisphere</strong>
            <small>control plane</small>
          </span>
        </Link>

        <nav className="primary-nav" aria-label="Primary navigation">
          <Link
            activeOptions={{ includeSearch: false }}
            activeProps={{ className: "nav-link active" }}
            className="nav-link"
            to="/accounts"
          >
            <AccountsIcon />
            Accounts
          </Link>
        </nav>

        <div className="access-note">
          <ShieldIcon />
          <div>
            <strong>Access protected</strong>
            <span>Identity is enforced at the Cloudflare edge.</span>
          </div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div>
            <span className="environment-dot" />
            Minisphere network
          </div>
          <span className="topbar-label">Private infrastructure</span>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
