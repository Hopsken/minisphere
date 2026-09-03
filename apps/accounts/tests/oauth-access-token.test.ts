import {
  Secp256k1PrivateKeyExportable,
  verifySigWithDidKey,
} from "@atcute/crypto";
import { describe, expect, it } from "vitest";

import {
  createOAuthAccessToken,
  createOAuthJwks,
} from "../worker/lib/oauth-access-token";

const input = {
  audience: "https://pds.test",
  clientId: "https://client.example/oauth-client-metadata.json",
  expiresIn: 300,
  issuer: "https://accounts.test",
  jwkThumbprint: "a".repeat(43),
  scope: "atproto",
  subject: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
};

const decodeBase64Url = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
};

describe("Accounts OAuth access-token signer", () => {
  it("signs a short-lived ES256K resource token", async () => {
    const signingKey = await Secp256k1PrivateKeyExportable.createKeypair();
    const token = await createOAuthAccessToken(
      input,
      await signingKey.exportPrivateKey("multikey"),
      1000
    );
    const parts = token.split(".");
    const [header, payload, signature = ""] = parts;
    const publicKey = await signingKey.exportPublicKey("did");

    expect(JSON.parse(decodeBase64Url(header ?? ""))).toStrictEqual({
      alg: "ES256K",
      kid: publicKey,
      typ: "at+jwt",
    });
    expect(JSON.parse(decodeBase64Url(payload ?? ""))).toMatchObject({
      aud: input.audience,
      client_id: input.clientId,
      cnf: { jkt: input.jwkThumbprint },
      exp: 1300,
      iat: 1000,
      iss: input.issuer,
      scope: "atproto",
      sub: input.subject,
    });
    await expect(
      verifySigWithDidKey(
        publicKey,
        Uint8Array.from(
          decodeBase64Url(signature),
          (character) => character.codePointAt(0) ?? 0
        ),
        new TextEncoder().encode(`${header}.${payload}`),
        { jwtAlg: "ES256K" }
      )
    ).resolves.toBeTruthy();
  });

  it("publishes only the corresponding public verification key", async () => {
    const signingKey = await Secp256k1PrivateKeyExportable.createKeypair();
    const jwks = await createOAuthJwks(
      await signingKey.exportPrivateKey("multikey")
    );

    expect(jwks).toStrictEqual({
      keys: [
        {
          alg: "ES256K",
          crv: "secp256k1",
          key_ops: ["verify"],
          kid: await signingKey.exportPublicKey("did"),
          kty: "EC",
          use: "sig",
          x: expect.stringMatching(/^[A-Za-z\d_-]{43}$/u),
          y: expect.stringMatching(/^[A-Za-z\d_-]{43}$/u),
        },
      ],
    });
    expect("d" in (jwks.keys[0] ?? {})).toBeFalsy();
  });

  it("does not sign a token longer than five minutes", async () => {
    const signingKey = await Secp256k1PrivateKeyExportable.createKeypair();
    await expect(
      createOAuthAccessToken(
        { ...input, expiresIn: 301 },
        await signingKey.exportPrivateKey("multikey")
      )
    ).rejects.toThrow(/300/u);
  });
});
