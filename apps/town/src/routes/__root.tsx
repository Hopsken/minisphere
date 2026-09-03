import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { TownConfiguration } from "@/router";

interface RouterContext {
  configuration: TownConfiguration;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
});
