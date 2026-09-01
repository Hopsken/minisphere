import type { AuthContext } from "better-auth";
import { createDpopReplayStore, verifyDpopProof } from "better-auth/oauth2";
import type { HonoRequest } from "hono";
import { decodeJwt } from "jose";
import { z } from "zod";

import type { OAuthSessionRecord } from "./oauth-state";
import { findRecord } from "./storage";
import type { AtprotoOAuthProviderOptions } from "./types";

export class DpopNonceError extends Error {
  constructor() {
    super("A valid server-issued DPoP nonce is required");
    this.name = "DpopNonceError";
  }
}

interface VerifyAtprotoDpopInput {
  accessToken?: string;
  adapter: AuthContext["internalAdapter"];
  expectedJkt?: string;
  method: string;
  proofJwt: string | null;
  url: string;
}

export const verifyAtprotoDpop = async ({
  accessToken,
  adapter,
  expectedJkt,
  method,
  proofJwt,
  url,
}: VerifyAtprotoDpopInput) => {
  const verificationInput: Parameters<typeof verifyDpopProof>[0] = {
    method,
    proofJwt: proofJwt ?? "",
    proofMaxAgeSeconds: 60,
    replayStore: createDpopReplayStore(adapter),
    requireAth: accessToken !== undefined,
    signingAlgorithms: ["ES256"],
    url,
  };
  if (accessToken !== undefined) {
    verificationInput.accessToken = accessToken;
  }
  if (expectedJkt !== undefined) {
    verificationInput.expectedJkt = expectedJkt;
  }
  const proof = await verifyDpopProof(verificationInput);

  const payload = z
    .object({ nonce: z.string() })
    .safeParse(decodeJwt(proofJwt ?? ""));
  if (!payload.success) {
    throw new DpopNonceError();
  }
  const { nonce } = payload.data;
  if (!(await findRecord(adapter, "dpop-nonce", nonce))) {
    throw new DpopNonceError();
  }
  return proof;
};

export const verifySessionDpop = (
  request: HonoRequest,
  context: AuthContext,
  options: AtprotoOAuthProviderOptions,
  path: string,
  session: OAuthSessionRecord | null
) => {
  const input = {
    adapter: context.internalAdapter,
    method: "POST",
    proofJwt: request.raw.headers.get("DPoP"),
    url: `${options.issuer}${path}`,
  };
  return session
    ? verifyAtprotoDpop({ ...input, expectedJkt: session.jwkThumbprint })
    : verifyAtprotoDpop(input);
};
