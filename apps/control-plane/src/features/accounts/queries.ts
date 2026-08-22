import { queryOptions } from "@tanstack/react-query";

import { api } from "../../lib/api";

export const accountKeys = {
  all: ["accounts"] as const,
};

export const accountsQuery = queryOptions({
  queryFn: async () => {
    const response = await api.accounts.$get();
    return response.json();
  },
  queryKey: accountKeys.all,
});
