import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { env, withEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { verifyOAuthAccessToken } from "../../pds/src/auth/oauth";
import { createDatabase } from "../worker/db";
import { oauthSigningKey } from "../worker/db/schema/oauth-signing-key";
import { createAuth } from "../worker/lib/better-auth";
import {
  decryptPrivateKey,
  encryptPrivateKey,
} from "../worker/lib/private-key-encryption";
import { OAuthSigningKeyRepository } from "../worker/repositories/oauth-signing-key-repository";
import { OAuthSigningKeys } from "../worker/services/oauth-signing-keys";

const input = {
  audience: "https://pds.test",
  clientId: "https://client.example/oauth-client-metadata.json",
  expiresIn: 300,
  issuer: "https://minisphere.test",
  jwkThumbprint: "a".repeat(43),
  scope: "atproto",
  subject: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
};
const secret = env.ACCOUNTS_ENCRYPTION_KEY;
const createKeys = () => new OAuthSigningKeys();
const records = () => new OAuthSigningKeyRepository(env.DB).list();
const requestJwks = () =>
  createAuth(env, createDatabase(env.DB)).handler(
    new Request(`${input.issuer}/oauth/jwks`)
  );
const fetcher: typeof fetch = (url) => {
  if (String(url).endsWith("/.well-known/oauth-authorization-server")) {
    return Promise.resolve(
      Response.json({
        issuer: input.issuer,
        jwks_uri: `${input.issuer}/oauth/jwks`,
      })
    );
  }
  return requestJwks();
};

describe("persisted OAuth signing keys", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM oauth_signing_key").run();
    vi.restoreAllMocks();
  });

  it("selects one key across concurrent initializers and verifies every token with the published JWKS", async () => {
    const generated = vi.spyOn(Secp256k1PrivateKeyExportable, "createKeypair");
    const tokens = await Promise.all(
      Array.from({ length: 8 }, () => createKeys().issueAccessToken(input))
    );
    expect(generated.mock.calls.length).toBeGreaterThan(1);
    const saved = await records();
    expect(saved.map((key) => key.status)).toStrictEqual(["current"]);
    const [storedKey] = saved;
    if (!storedKey) {
      throw new Error("Missing persisted key");
    }
    await Promise.all(
      tokens.map(async (token) => {
        await expect(
          verifyOAuthAccessToken(token, input.issuer, input.audience, fetcher)
        ).resolves.toMatchObject({
          cnf: { jkt: input.jwkThumbprint },
          scope: "atproto",
          sub: input.subject,
        });
      })
    );
    const jwks = await createKeys().getJwks();
    expect(jwks).toStrictEqual({
      keys: [
        {
          alg: "ES256K",
          crv: "secp256k1",
          key_ops: ["verify"],
          kid: saved[0]?.kid,
          kty: "EC",
          use: "sig",
          x: saved[0]?.publicX,
          y: saved[0]?.publicY,
        },
      ],
    });
    const privateKey = await decryptPrivateKey(
      storedKey,
      { keyId: storedKey.kid, purpose: "oauth-access-token" },
      secret
    );
    expect(JSON.stringify(saved)).not.toContain(privateKey);
  });

  it("keeps the key when services and providers are reconstructed", async () => {
    const token = await createKeys().issueAccessToken(input);
    const saved = await records();
    const firstResponse = await requestJwks();
    const secondResponse = await requestJwks();
    const first = await firstResponse.json();
    const second = await secondResponse.json();
    expect(second).toStrictEqual(first);
    await expect(
      verifyOAuthAccessToken(token, input.issuer, input.audience, fetcher)
    ).resolves.toMatchObject({ sub: input.subject });
    await createKeys().issueAccessToken(input);
    await expect(records()).resolves.toStrictEqual(saved);
  });

  it("rejects a signature from a different key with the correct kid", async () => {
    const token = await createKeys().issueAccessToken(input);
    const [header, payload] = token.split(".");
    const wrongKey = await Secp256k1PrivateKeyExportable.createKeypair();
    const signature = await wrongKey.sign(
      new TextEncoder().encode(`${header}.${payload}`)
    );
    const encoded = btoa(String.fromCodePoint(...signature))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    await expect(
      verifyOAuthAccessToken(
        `${header}.${payload}.${encoded}`,
        input.issuer,
        input.audience,
        fetcher
      )
    ).rejects.toThrow(/signature/u);
  });

  it("publishes retired keys without decryption, excludes disabled keys, and never reinitializes a nonempty table", async () => {
    const jwks = await createKeys().getJwks();
    await env.DB.prepare(
      "UPDATE oauth_signing_key SET status = 'retired'"
    ).run();
    await expect(
      withEnv(
        {
          ...env,
          ACCOUNTS_ENCRYPTION_KEY: "wrong-secret-but-at-least-32-characters",
        },
        () => createKeys().getJwks()
      )
    ).resolves.toStrictEqual(jwks);
    await expect(createKeys().issueAccessToken(input)).rejects.toThrow(
      "No current OAuth signing key"
    );
    await env.DB.prepare(
      "UPDATE oauth_signing_key SET status = 'disabled'"
    ).run();
    await expect(createKeys().getJwks()).resolves.toStrictEqual({ keys: [] });
    await expect(createKeys().issueAccessToken(input)).rejects.toThrow(
      "No current OAuth signing key"
    );
    await expect(records()).resolves.toHaveLength(1);
  });

  it.each<"retired" | "disabled">(["retired", "disabled"])(
    "does not initialize the repository when only a %s key exists",
    async (status) => {
      await createKeys().getJwks();
      await createDatabase(env.DB).update(oauthSigningKey).set({ status });
      const repository = new OAuthSigningKeyRepository(env.DB);
      const saved = await repository.list();
      const [existing] = saved;
      if (!existing) {
        throw new Error("Missing persisted key");
      }

      const result = await repository.initializeIfEmpty({
        encryptedPrivateKey: existing.encryptedPrivateKey,
        encryptionIv: existing.encryptionIv,
        // A different kid prevents a primary-key conflict from hiding an insert.
        kid: "unexpected-initialization",
        publicX: existing.publicX,
        publicY: existing.publicY,
      });

      expect(result).toStrictEqual(saved);
      await expect(repository.list()).resolves.toStrictEqual(saved);
    }
  );

  it("enforces one current key while allowing retained public keys", async () => {
    const original = await createKeys().getJwks();
    const originalKid = original.keys[0]?.kid;
    const copy = (kid: string, status: string) =>
      env.DB.prepare(`INSERT INTO oauth_signing_key
      (kid, status, public_x, public_y, encrypted_private_key, encryption_iv)
      SELECT ?, ?, public_x, public_y, encrypted_private_key, encryption_iv FROM oauth_signing_key WHERE kid = ?`)
        .bind(kid, status, originalKid)
        .run();
    await expect(copy("second-current", "current")).rejects.toThrow(/UNIQUE/u);
    await copy("retired", "retired");
    await copy("disabled", "disabled");
    const jwks = await createKeys().getJwks();
    expect(jwks.keys.map((key) => key.kid).toSorted()).toStrictEqual(
      [originalKid, "retired"].toSorted()
    );
  });

  it.each(["ciphertext", "iv", "public-key", "secret"])(
    "fails closed on %s corruption without replacing the key",
    async (failure) => {
      await createKeys().getJwks();
      if (failure === "ciphertext") {
        await env.DB.prepare(
          `UPDATE oauth_signing_key SET encrypted_private_key =
            (CASE WHEN substr(encrypted_private_key, 1, 1) = 'A' THEN 'B' ELSE 'A' END)
            || substr(encrypted_private_key, 2)`
        ).run();
      } else if (failure === "iv") {
        await env.DB.prepare(
          "UPDATE oauth_signing_key SET encryption_iv = 'AAAA'"
        ).run();
      } else if (failure === "public-key") {
        await env.DB.prepare(
          "UPDATE oauth_signing_key SET public_x = 'wrong'"
        ).run();
      }
      const saved = await records();
      await expect(
        withEnv(
          {
            ...env,
            ACCOUNTS_ENCRYPTION_KEY:
              failure === "secret"
                ? "wrong-secret-but-at-least-32-characters"
                : secret,
          },
          () => createKeys().issueAccessToken(input)
        )
      ).rejects.toThrow(/private-key encryption IV|public key|Decrypt/u);
      await expect(records()).resolves.toStrictEqual(saved);
    }
  );

  it("does not generate a replacement when database reads fail", async () => {
    await createKeys().getJwks();
    const saved = await records();
    vi.spyOn(
      OAuthSigningKeyRepository.prototype,
      "list"
    ).mockImplementationOnce(() => {
      throw new Error("Database unavailable");
    });
    const initializeIfEmpty = vi.spyOn(
      OAuthSigningKeyRepository.prototype,
      "initializeIfEmpty"
    );
    await expect(createKeys().issueAccessToken(input)).rejects.toThrow(
      "Database unavailable"
    );
    expect(initializeIfEmpty).not.toHaveBeenCalled();
    await expect(records()).resolves.toStrictEqual(saved);
  });

  it("propagates initialization writes that fail and leaves no local fallback", async () => {
    vi.spyOn(
      OAuthSigningKeyRepository.prototype,
      "initializeIfEmpty"
    ).mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(createKeys().issueAccessToken(input)).rejects.toThrow(
      "Database unavailable"
    );
    await expect(records()).resolves.toStrictEqual([]);
  });
});

describe("private-key encryption", () => {
  it("decrypts the existing AES-GCM storage format", async () => {
    // Fixed test fixture: AES-256-GCM, SHA-256(secret), AAD [purpose, keyId].
    await expect(
      decryptPrivateKey(
        {
          encryptedPrivateKey: "6EHYJwLyoDg3fUyoFm3XJJLChaSLSQAL0T0wZM17McE=",
          encryptionIv: "AAECAwQFBgcICQoL",
        },
        { keyId: "key-a", purpose: "oauth-access-token" },
        "format-test-secret-at-least-32-characters"
      )
    ).resolves.toBe("private-material");
  });

  it("uses random IVs, round trips, and binds both purpose and key identity", async () => {
    const context = { keyId: "key-a", purpose: "oauth-access-token" };
    const first = await encryptPrivateKey("private-material", context, secret);
    const second = await encryptPrivateKey("private-material", context, secret);
    expect({
      sameCiphertext: second.encryptedPrivateKey === first.encryptedPrivateKey,
      sameIv: second.encryptionIv === first.encryptionIv,
    }).toStrictEqual({ sameCiphertext: false, sameIv: false });
    await expect(decryptPrivateKey(first, context, secret)).resolves.toBe(
      "private-material"
    );
    await expect(
      decryptPrivateKey(first, { ...context, purpose: "plc-rotation" }, secret)
    ).rejects.toThrow(/Decrypt/u);
    await expect(
      decryptPrivateKey(first, { ...context, keyId: "key-b" }, secret)
    ).rejects.toThrow(/Decrypt/u);
    await expect(
      encryptPrivateKey("private-material", context, "short")
    ).rejects.toThrow("ACCOUNTS_ENCRYPTION_KEY");
  });
});
