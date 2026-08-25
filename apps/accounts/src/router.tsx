import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { toast } from "sonner";

import { routeTree } from "./routeTree.gen";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: {
      skipGlobalError?: boolean;
    };
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
    },
  },

  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (!mutation.options.onError) {
        toast.error(`Error: ${error.message}`);
      }
    },
  }),

  queryCache: new QueryCache({
    onError: (error, query) => {
      if (!query.meta?.skipGlobalError) {
        toast.error(`Error: ${error.message}`);
      }
    },
  }),
});

export const router = createRouter({
  context: { queryClient },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  routeTree,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
