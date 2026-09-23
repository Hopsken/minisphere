import { isDid } from "@atcute/lexicons/syntax";
import { HTTPException } from "hono/http-exception";
import {
  base64url,
  calculateJwkThumbprint,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
} from "jose";
import { z } from "zod";

import type { AccountRepository } from "../repositories/account";
import type { DpopStateRepository } from "../repositories/dpop-state";
import { verifyOAuthAccessToken } from "./oauth";

const proofClaims = z.object({
  ath: z.string(),
  htm: z.string(),
  htu: z.string(),
  jti: z.string().min(1).max(256),
  nonce: z.string().optional(),
});

export const resourceError = (
  error: string,
  message: string,
  status: 401 | 403 = 401
) =>
  new HTTPException(status, {
    res: Response.json(
      { error, message },
      {
        headers: { "WWW-Authenticate": `DPoP error="${error}"` },
        status,
      }
    ),
  });

export class ResourceAuth {
  private readonly accounts: AccountRepository;
  private readonly state: DpopStateRepository;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly fetcher: typeof fetch;

  constructor(
    accounts: AccountRepository,
    state: DpopStateRepository,
    issuer: string,
    audience: string,
    fetcher: typeof fetch = fetch
  ) {
    this.accounts = accounts;
    this.state = state;
    this.issuer = issuer;
    this.audience = audience;
    this.fetcher = fetcher;
  }

  async authenticate(request: Request) {
    const match = /^DPoP (?<token>[^\s,]+)$/iu.exec(
      request.headers.get("Authorization") ?? ""
    );
    const token = match?.groups?.token;
    if (!token) {
      throw resourceError(
        "invalid_token",
        "A DPoP-bound access token is required"
      );
    }
    const claims = await verifyOAuthAccessToken(
      token,
      this.issuer,
      this.audience,
      this.fetcher
    ).catch(() => {
      throw resourceError("invalid_token", "Invalid access token");
    });
    const did = claims.sub;
    if (!isDid(did) || !(await this.accounts.exists(did))) {
      throw resourceError("invalid_token", "Account is not hosted here");
    }

    const proof = request.headers.get("DPoP") ?? "";
    const payload = await this.verifyProof(
      proof,
      token,
      claims.cnf.jkt,
      request
    );
    if (!payload.nonce || !(await this.state.hasNonce(payload.nonce))) {
      throw resourceError(
        "use_dpop_nonce",
        "A server-issued DPoP nonce is required"
      );
    }
    if (!(await this.state.claimProof(claims.cnf.jkt, payload.jti))) {
      throw resourceError("invalid_dpop_proof", "DPoP proof was already used");
    }
    return { did, scope: claims.scope };
  }

  private async verifyProof(
    proof: string,
    token: string,
    jkt: string,
    request: Request
  ) {
    try {
      const header = decodeProtectedHeader(proof);
      if (!header.jwk || "d" in header.jwk) {
        throw new Error("Public proof key required");
      }
      const key = await importJWK(header.jwk, "ES256");
      const { payload } = await jwtVerify(proof, key, {
        algorithms: ["ES256"],
        maxTokenAge: 60,
        requiredClaims: ["iat", "jti", "htm", "htu", "ath"],
        typ: "dpop+jwt",
      });
      const parsed = proofClaims.parse(payload);
      const url = new URL(request.url);
      const expectedUrl = `${this.audience}${url.pathname}`;
      const ath = base64url.encode(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
        )
      );
      if (
        parsed.htm !== request.method ||
        parsed.htu !== expectedUrl ||
        parsed.ath !== ath ||
        (await calculateJwkThumbprint(header.jwk)) !== jkt
      ) {
        throw new Error("Proof binding mismatch");
      }
      return parsed;
    } catch {
      throw resourceError("invalid_dpop_proof", "Invalid DPoP proof");
    }
  }
}
