import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono";

import { api } from "@/lib/api";

export const accountKeys = {
  account: ["account"] as const,
  appPasswords: (userId: string) =>
    ["account", "app-passwords", userId] as const,
  plc: (userId: string) => ["account", "plc", userId] as const,
  username: (username: string) => ["account", "username", username] as const,
};

export type Account = InferResponseType<typeof api.account.$get>;
export type PlcAccount = InferResponseType<typeof api.account.plc.$get>;

export const plcAccountQuery = (userId: string) =>
  queryOptions({
    meta: { skipGlobalError: true },
    queryFn: async () => {
      const response = await api.account.plc.$get();
      if (!response.ok) {
        throw new Error(
          "Could not read your PDS endpoint from the PLC Directory."
        );
      }
      return response.json();
    },
    queryKey: accountKeys.plc(userId),
    retry: false,
  });

export type AppPassword = InferResponseType<
  (typeof api.account)["app-passwords"]["$get"]
>["appPasswords"][number];

export const appPasswordsQuery = (userId: string) =>
  queryOptions({
    queryFn: async () => {
      const response = await api.account["app-passwords"].$get();
      if (!response.ok) {
        throw new Error("Could not load your app passwords");
      }
      const { appPasswords } = await response.json();
      return appPasswords;
    },
    queryKey: accountKeys.appPasswords(userId),
  });

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
