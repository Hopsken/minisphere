import {
  parsePrivateMultikey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import type { Did } from "@atcute/lexicons/syntax";
import { env } from "cloudflare:workers";
import { base64url } from "jose";

import worker from "../src";
import { createPdsDatabase } from "../src/db";
import { accountsTable } from "../src/db/schema";

export const ORIGIN = "https://pds.test";
export const ISSUER = "https://minisphere.test";
export const PDS_DID = "did:web:pds.test";

/** A repository that is registered as hosted, like one created by Accounts. */
export const createHostedAccount = async (register = true) => {
  const suffix = Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    (byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte % 32]
  ).join("");
  const did: Did<"plc"> = `did:plc:${suffix}`;
  const repoKey = await Secp256k1PrivateKeyExportable.createKeypair();
  await env.REPO.getByName(did).reserveRepo(
    did,
    await repoKey.exportPrivateKey("multikey")
  );
  if (register) {
    await createPdsDatabase(env.PDS_DB).insert(accountsTable).values({ did });
  }
  return { did, repoKeyDid: await repoKey.exportPublicKey("did") };
};

type Claims = Record<string, string | number | Record<string, string>>;

/** Signs an Accounts app-password access token (ADR 0013). */
export const signAppPasswordToken = async (
  did: string,
  overrides: (issuedAt: number) => Claims = () => ({}),
  signWithUntrustedKey = false
) => {
  const accountsKey = await Secp256k1PrivateKey.importRaw(
    parsePrivateMultikey(env.TEST_ACCOUNTS_OAUTH_SIGNING_KEY).privateKeyBytes
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64url.encode(
    JSON.stringify({
      alg: "ES256K",
      kid: await accountsKey.exportPublicKey("did"),
      typ: "at+jwt",
    })
  );
  const payload = base64url.encode(
    JSON.stringify({
      aud: PDS_DID,
      exp: now + 300,
      iat: now,
      iss: ISSUER,
      jti: crypto.randomUUID(),
      scope: "com.atproto.appPass",
      sub: did,
      ...overrides(now),
    })
  );
  const signingKey = signWithUntrustedKey
    ? await Secp256k1PrivateKeyExportable.createKeypair()
    : accountsKey;
  const signature = await signingKey.sign(
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${base64url.encode(signature)}`;
};

export const xrpc = (
  method: string,
  init: RequestInit & { token?: string; query?: Record<string, string> } = {}
) => {
  const { query, token, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const search = query ? `?${new URLSearchParams(query)}` : "";
  return worker.fetch(
    new Request(`${ORIGIN}/xrpc/${method}${search}`, { ...rest, headers }),
    env
  );
};
