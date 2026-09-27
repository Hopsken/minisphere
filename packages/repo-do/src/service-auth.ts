import type { Secp256k1Keypair } from "@atproto/crypto";

const encode = (value: Uint8Array | string) =>
  Buffer.from(value).toString("base64url");

interface ServiceJwtClaims {
  aud: string;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  lxm: string;
}

export interface ServiceAuthOptions {
  aud: string;
  /** Seconds since the epoch; defaults to one minute from now. */
  exp?: number | undefined;
  /** Required: a token without a method would be valid for every method. */
  lxm: string;
}

/**
 * An inter-service JWT signed by the account's repository key, in the format
 * of `@atproto/xrpc-server`'s `createServiceJwt`.
 */
export const createServiceJwt = async (
  keypair: Secp256k1Keypair,
  iss: string,
  { aud, exp, lxm }: ServiceAuthOptions
) => {
  const iat = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: keypair.jwtAlg, typ: "JWT" }));
  const claims: ServiceJwtClaims = {
    aud,
    exp: exp ?? iat + 60,
    iat,
    iss,
    jti: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
      "hex"
    ),
    lxm,
  };
  const payload = encode(JSON.stringify(claims));
  const signature = await keypair.sign(
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${encode(signature)}`;
};
