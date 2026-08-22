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

  queryCache: new QueryCache({
    onError: (error, query) => {
      // Skip showing global toast if a specific query disables it via meta
      if (query.meta?.skipGlobalError) {
        return;
      }

      toast.error(`Error: ${error.message}`);
    },
  }),

  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Skip if local handler exists
      if (mutation.options.onError) {
        return;
      }
      toast.error(`Error: ${error.message}`);
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
