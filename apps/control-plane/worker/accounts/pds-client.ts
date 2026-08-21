import { ComAtprotoServerCreateAccount } from "@atcute/atproto";
import {
  Client,
  ClientValidationError,
  simpleFetchHandler,
} from "@atcute/client";

export interface CreatePdsAccountInput {
  handle: `${string}.${string}`;
  inviteCode: string;
  password: string;
  recoveryKey: string;
}

export interface CreatedPdsAccount {
  accessJwt: string;
  did: string;
  handle: string;
  refreshJwt: string;
}

export class PdsAccountError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PdsAccountError";
    this.code = code;
    this.status = status;
  }
}

export const createPdsAccount = async (
  pdsOrigin: string,
  input: CreatePdsAccountInput,
  request: typeof globalThis.fetch = globalThis.fetch
): Promise<CreatedPdsAccount> => {
  const client = new Client({
    handler: simpleFetchHandler({ fetch: request, service: pdsOrigin }),
  });

  let response;
  try {
    response = await client.call(ComAtprotoServerCreateAccount, { input });
  } catch (error) {
    if (error instanceof ClientValidationError) {
      throw new PdsAccountError(
        502,
        "PdsUnavailable",
        `PDS returned an invalid createAccount ${error.target}`
      );
    }
    throw new PdsAccountError(502, "PdsUnavailable", "Could not reach the PDS");
  }

  if (!response.ok) {
    throw new PdsAccountError(
      response.status,
      response.data.error,
      response.data.message ?? "PDS rejected the account"
    );
  }

  return response.data;
};
