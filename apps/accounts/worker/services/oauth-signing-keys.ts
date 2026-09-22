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

  private async getKeys() {
    const existing = await this.repository.list();
    if (existing.length > 0) {
      return existing;
    }
    const key = await Secp256k1PrivateKeyExportable.createKeypair();
    const kid = await key.exportPublicKey("did");
    const jwk = z
      .object({ x: z.string(), y: z.string() })
      .parse(await key.exportPublicKey("jwk"));
    return this.repository.initialize({
      kid,
      publicX: jwk.x,
      publicY: jwk.y,
      status: "current",
      ...(await encryptPrivateKey(
        await key.exportPrivateKey("multikey"),
        purpose,
        kid,
        env.ACCOUNTS_ENCRYPTION_KEY
      )),
    });
  }

  async issueAccessToken(input: AtprotoAccessTokenInput) {
    const keys = await this.getKeys();
    const current = keys.find((key) => key.status === "current");
    if (!current) {
      throw new Error("No current OAuth signing key");
    }
    const privateKey = await decryptPrivateKey(
      current,
      purpose,
      current.kid,
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
    return createOAuthAccessToken(input, key);
  }

  async getJwks() {
    const keys = await this.getKeys();
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
