import {
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import type { PrivateKey } from "@atcute/crypto";
import { env, exports } from "cloudflare:workers";
import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import z from "zod";

import { getInviteCodeSigningInput } from "../src/auth/invite-code";

const ORIGIN = "https://internal.test";
const PDS_ORIGIN = "https://pds.test";
const PASSWORD = "machine-generated-password";

const request = (path: string, init?: RequestInit): Promise<Response> =>
  exports.default.fetch(new Request(`${ORIGIN}${path}`, init));

const createAccountResponseSchema = z.object({
  accessJwt: z.string(),
  did: z.string(),
  handle: z.string(),
  refreshJwt: z.string(),
});
const jwtHeaderSchema = z.object({
  alg: z.literal("HS256"),
  typ: z.enum(["at+jwt", "refresh+jwt"]),
});
const jwtClaimsSchema = z.object({
  aud: z.string(),
  exp: z.number(),
  iat: z.number(),
  jti: z.string().optional(),
  scope: z.string(),
  sub: z.string(),
});

interface CreateAccountOverrides {
  handle?: string;
  inviteCode?: string;
  password?: string;
  recoveryKey?: string;
}

const encodeBase64Url = (value: Uint8Array): string =>
  Buffer.from(value).toString("base64url");

const createInviteCode = async (key?: PrivateKey): Promise<string> => {
  const code = encodeBase64Url(new Uint8Array(32).fill(2));
  const signer =
    key ?? (await Secp256k1PrivateKey.importRaw(new Uint8Array(32).fill(1)));
  const signature = await signer.sign(
    getInviteCodeSigningInput(code, PDS_ORIGIN)
  );
  return `v1.${code}.${encodeBase64Url(signature)}`;
};

const postAccount = async (
  overrides: CreateAccountOverrides = {}
): Promise<Response> => {
  const recoveryKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const recoveryKeyDid = await recoveryKey.exportPublicKey("did");
  return request("/xrpc/com.atproto.server.createAccount", {
    body: JSON.stringify({
      handle: "agent.pds.test",
      inviteCode: await createInviteCode(),
      password: PASSWORD,
      recoveryKey: recoveryKeyDid,
      ...overrides,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
};

describe("com.atproto.server.createAccount", () => {
  it("verifies the control-plane invite and creates an account session", async () => {
    const response = await postAccount();
    expect(response.status).toBe(200);

    const payload = createAccountResponseSchema.parse(await response.json());
    expect(payload).toMatchObject({
      accessJwt: expect.any(String),
      did: expect.stringMatching(/^did:plc:/u),
      handle: "agent.pds.test",
      refreshJwt: expect.any(String),
    });

    const accessToken = await jwtVerify(
      payload.accessJwt,
      new TextEncoder().encode(env.PDS_JWT_SECRET),
      { audience: "did:web:pds.test", subject: payload.did }
    );
    expect({
      claims: jwtClaimsSchema.parse(accessToken.payload),
      header: jwtHeaderSchema.parse(accessToken.protectedHeader),
    }).toMatchObject({
      claims: {
        aud: "did:web:pds.test",
        scope: "com.atproto.access",
        sub: payload.did,
      },
      header: { alg: "HS256", typ: "at+jwt" },
    });

    const refreshToken = await jwtVerify(
      payload.refreshJwt,
      new TextEncoder().encode(env.PDS_JWT_SECRET),
      { audience: "did:web:pds.test", subject: payload.did }
    );
    const refreshClaims = jwtClaimsSchema.parse(refreshToken.payload);
    expect({
      claims: refreshClaims,
      header: jwtHeaderSchema.parse(refreshToken.protectedHeader),
    }).toMatchObject({
      claims: {
        aud: "did:web:pds.test",
        jti: expect.any(String),
        scope: "com.atproto.refresh",
        sub: payload.did,
      },
      header: { alg: "HS256", typ: "refresh+jwt" },
    });

    const handleResponse = await exports.default.fetch(
      new Request("https://agent.pds.test/.well-known/atproto-did")
    );
    const repoObject = env.REPO.getByName(payload.did);
    const [account, indexedDid, resolvedDid, storedRefreshToken, repo] =
      await Promise.all([
        env.ACCOUNT_DB.prepare(
          "SELECT did, handle, password_hash FROM accounts WHERE did = ?"
        )
          .bind(payload.did)
          .first(),
        env.HANDLES.get(payload.handle),
        handleResponse.text(),
        env.ACCOUNT_DB.prepare(
          "SELECT did, jti, expires_at FROM refresh_tokens WHERE did = ?"
        )
          .bind(payload.did)
          .first(),
        repoObject.rpcGetRepoStatus(),
      ]);
    expect({
      account,
      handleContentType: handleResponse.headers.get("Content-Type"),
      handleStatus: handleResponse.status,
      indexedDid,
      repo,
      resolvedDid,
      storedRefreshToken,
    }).toMatchObject({
      account: {
        did: payload.did,
        handle: payload.handle,
        password_hash: expect.stringMatching(
          /^pbkdf2-sha256\$210000\$[0-9a-f]{32}\$[0-9a-f]{64}$/u
        ),
      },
      handleContentType: expect.stringContaining("text/plain"),
      handleStatus: 200,
      indexedDid: payload.did,
      repo: {
        did: payload.did,
        head: expect.any(String),
        rev: expect.any(String),
      },
      resolvedDid: payload.did,
      storedRefreshToken: {
        did: payload.did,
        expires_at: expect.any(Number),
        jti: refreshClaims.jti,
      },
    });
  });

  it("rejects a handle that already has an account", async () => {
    const handle = "duplicate.pds.test";
    const first = await postAccount({ handle });
    expect(first.status).toBe(200);

    const duplicate = await postAccount({ handle });
    expect(duplicate.status).toBe(400);
    await expect(duplicate.json()).resolves.toStrictEqual({
      error: "HandleNotAvailable",
      message: "Handle is not available",
    });
  });

  it("rejects an invite not signed by the control plane", async () => {
    const otherKey = await Secp256k1PrivateKeyExportable.createKeypair();
    const response = await postAccount({
      handle: "unsigned.pds.test",
      inviteCode: await createInviteCode(otherKey),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({
      error: "InvalidInviteCode",
      message: "Invalid invite code",
    });
  });

  it("requires the local handle, machine password, and recovery key", async () => {
    const invalidHandle = await postAccount({ handle: "agent.example.com" });
    expect(invalidHandle.status).toBe(400);

    const invalidPassword = await postAccount({
      handle: "password.pds.test",
      password: String(),
    });
    expect(invalidPassword.status).toBe(400);

    const invalidRecoveryKey = await postAccount({
      handle: "recovery.pds.test",
      recoveryKey: "not-a-key",
    });
    expect(invalidRecoveryKey.status).toBe(400);
  });

  it("removes the former custom admin registration endpoint", async () => {
    const response = await request("/admin/register", {
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  it("does not publish unknown or external handles", async () => {
    const [unknown, external] = await Promise.all([
      exports.default.fetch(
        new Request("https://unknown.pds.test/.well-known/atproto-did")
      ),
      exports.default.fetch(
        new Request("https://other.test/.well-known/atproto-did")
      ),
    ]);

    expect(unknown.status).toBe(404);
    expect(external.status).toBe(404);
  });
});
