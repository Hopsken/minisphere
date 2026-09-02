import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api";

export const configurationQuery = queryOptions({
  queryFn: async () => {
    const response = await api.configuration.$get();
    if (!response.ok) {
      throw new Error("Could not load the application configuration");
    }
    return response.json();
  },
  queryKey: ["configuration"] as const,
  staleTime: Number.POSITIVE_INFINITY,
});
