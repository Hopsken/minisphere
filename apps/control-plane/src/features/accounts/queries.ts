import { queryOptions } from "@tanstack/react-query";

import { getAccount, getConfig, listAccounts } from "../../lib/api";

export const accountKeys = {
  all: ["accounts"] as const,
  detail: (did: string) => ["accounts", did] as const,
};

export const accountsQuery = queryOptions({
  queryFn: listAccounts,
  queryKey: accountKeys.all,
});

export const accountQuery = (did: string) =>
  queryOptions({
    queryFn: () => getAccount(did),
    queryKey: accountKeys.detail(did),
  });

export const configQuery = queryOptions({
  queryFn: getConfig,
  queryKey: ["config"],
  staleTime: Number.POSITIVE_INFINITY,
});
