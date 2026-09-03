import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono";

import { api } from "@/lib/api";

export const accountKeys = {
  account: ["account"] as const,
  username: (username: string) => ["account", "username", username] as const,
};

export type Account = InferResponseType<typeof api.account.$get>;

export const accountQuery = queryOptions({
  queryFn: async () => {
    const response = await api.account.$get();
    if (!response.ok) {
      throw new Error("Could not load your account");
    }
    return response.json();
  },
  queryKey: accountKeys.account,
});

export const usernameAvailabilityQuery = (username: string) =>
  queryOptions({
    enabled: Boolean(username),
    queryFn: async () => {
      const response = await api.account.usernames[":username"].$get({
        param: { username },
      });
      if (!response.ok) {
        throw new Error("Could not check username availability");
      }
      return response.json();
    },
    queryKey: accountKeys.username(username),
    staleTime: 5000,
  });
