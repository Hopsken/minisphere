import type { InferResponseType } from "hono/client";
import { hc } from "hono/client";

import type { ApiType } from "../../worker/app";

const client = hc<ApiType>("/api");

type AccountsResponse = InferResponseType<typeof client.accounts.$get, 200>;
type AccountResponse = InferResponseType<
  (typeof client.accounts)[":did"]["$get"],
  200
>;
type ConfigResponse = InferResponseType<typeof client.config.$get, 200>;

export type ManagedAccount = AccountsResponse["accounts"][number];
export type ControlPlaneConfig = ConfigResponse;

export interface CreateAccountInput {
  name: string;
}

interface ErrorResponse {
  json: () => Promise<object>;
  status: number;
}

const throwResponseError = async (response: ErrorResponse): Promise<never> => {
  let message = `Request failed with status ${response.status}`;
  try {
    const payload = await response.json();
    if ("message" in payload) {
      const { message: payloadMessage } = payload;
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- This is the parsing boundary for HTML or JSON error responses from Hono and Cloudflare Access.
      if (typeof payloadMessage === "string") {
        message = payloadMessage;
      }
    }
  } catch {
    // Cloudflare Access may return a redirect or an HTML login response after
    // the session expires. Keep the status-based fallback in that case.
  }
  throw new Error(message);
};

export const getConfig = async (): Promise<ControlPlaneConfig> => {
  const response = await client.config.$get();
  if (!response.ok) {
    return throwResponseError(response);
  }
  return response.json();
};

export const listAccounts = async (): Promise<ManagedAccount[]> => {
  const response = await client.accounts.$get();
  if (!response.ok) {
    return throwResponseError(response);
  }
  const payload = await response.json();
  return payload.accounts;
};

export const getAccount = async (did: string): Promise<ManagedAccount> => {
  const response = await client.accounts[":did"].$get({ param: { did } });
  if (!response.ok) {
    return throwResponseError(response);
  }
  const payload: AccountResponse = await response.json();
  return payload.account;
};

export const createAccount = async (
  input: CreateAccountInput
): Promise<ManagedAccount> => {
  const response = await client.accounts.$post({ json: input });
  if (!response.ok) {
    return throwResponseError(response);
  }
  const payload = await response.json();
  return payload.account;
};
