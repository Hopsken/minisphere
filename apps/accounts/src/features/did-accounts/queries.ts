import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono";

import { api } from "@/lib/api";

export const didAccountsKeys = {
  list: ["accounts", "list"] as const,
};

export type DidAccount = InferResponseType<
  typeof api.accounts.atproto.$get
>[number];

export const didAccountsQuery = queryOptions({
  queryFn: async () => {
    const response = await api.accounts.atproto.$get();
    return response.json();
  },
  queryKey: didAccountsKeys.list,
});
