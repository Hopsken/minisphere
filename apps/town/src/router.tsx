import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

export interface TownConfiguration {
  clientId: string;
  pdsOrigin: string;
  redirectUri: string;
  scope: string;
}

export const createAppRouter = (configuration: TownConfiguration) =>
  createRouter({
    context: { configuration },
    defaultPreload: "intent",
    routeTree,
    scrollRestoration: true,
  });

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
