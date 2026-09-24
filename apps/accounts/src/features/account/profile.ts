import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api";

export const accountProfileQuery = (userId: string) =>
  queryOptions({
    meta: { skipGlobalError: true },
    queryFn: async ({ signal }) => {
      const response = await api.account.profile.$get(undefined, {
        init: { signal },
      });
      if (!response.ok) {
        return null;
      }
      const { profile } = await response.json();
      return profile;
    },
    queryKey: ["account", "profile", userId],
    refetchOnWindowFocus: "always",
    retry: false,
    staleTime: 0,
  });
