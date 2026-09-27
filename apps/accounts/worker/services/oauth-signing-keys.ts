import {
  parsePrivateMultikey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import type { AtprotoAccessTokenInput } from "@minisphere/atproto-oauth-provider";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { createOAuthAccessToken } from "../lib/oauth-access-token";
import {
  decryptPrivateKey,
  encryptPrivateKey,
} from "../lib/private-key-encryption";
import { OAuthSigningKeyRepository } from "../repositories/oauth-signing-key-repository";

const purpose = "oauth-access-token";

export class OAuthSigningKeys {
  private readonly repository = new OAuthSigningKeyRepository(env.DB);

  private async getOrInitializeKeys() {
    const existing = await this.repository.list();
    if (existing.length > 0) {
      return existing;
    }
    const key = await Secp256k1PrivateKeyExportable.createKeypair();
    const kid = await key.exportPublicKey("did");
    const jwk = z
      .object({ x: z.string(), y: z.string() })
      .parse(await key.exportPublicKey("jwk"));
    const privateKey = await key.exportPrivateKey("multikey");
    const encrypted = await encryptPrivateKey(
      privateKey,
      { keyId: kid, purpose },
      env.ACCOUNTS_ENCRYPTION_KEY
    );

    return this.repository.initializeIfEmpty({
      ...encrypted,
      kid,
      publicX: jwk.x,
      publicY: jwk.y,
    });
  }

  /** The current key, which signs OAuth access tokens and app-password sessions. */
  async getCurrentKey() {
    const keys = await this.getOrInitializeKeys();
    const current = keys.find((key) => key.status === "current");
    if (!current) {
      throw new Error("No current OAuth signing key");
    }
    const privateKey = await decryptPrivateKey(
      current,
      { keyId: current.kid, purpose },
      env.ACCOUNTS_ENCRYPTION_KEY
    );
    const parsed = parsePrivateMultikey(privateKey);
    if (parsed.type !== "secp256k1") {
      throw new Error("OAuth signing key must use secp256k1");
    }
    const key = await Secp256k1PrivateKey.importRaw(parsed.privateKeyBytes);
    const jwk = await key.exportPublicKey("jwk");
    if (
      (await key.exportPublicKey("did")) !== current.kid ||
      jwk.x !== current.publicX ||
      jwk.y !== current.publicY
    ) {
      throw new Error("OAuth signing key does not match its public key");
    }
    return key;
  }

  async issueAccessToken(input: AtprotoAccessTokenInput) {
    return createOAuthAccessToken(input, await this.getCurrentKey());
  }

  /** Whether `kid` names a key that the JWKS still publishes. */
  async isPublished(kid: string) {
    const keys = await this.getOrInitializeKeys();
    return keys.some((key) => key.kid === kid && key.status !== "disabled");
  }

  async getJwks() {
    const keys = await this.getOrInitializeKeys();
    return {
      keys: keys
        .filter((key) => key.status !== "disabled")
        .map((key) => ({
          alg: "ES256K",
          crv: "secp256k1",
          key_ops: ["verify"],
          kid: key.kid,
          kty: "EC",
          use: "sig",
          x: key.publicX,
          y: key.publicY,
        })),
    };
  }
}
