import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { env, exports } from "cloudflare:workers";
import { jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import z from "zod";

import { InviteCodeRepository } from "../src/repositories/invite-code";

const ORIGIN = "https://internal.test";
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
  did?: string;
  handle?: string;
  inviteCode?: string;
  password?: string;
  recoveryKey?: string;
}

const createInviteCode = (): Promise<string> =>
  exports.PdsControlPlane.generateInviteCode();

const postAccount = async (
  overrides: CreateAccountOverrides = {}
): Promise<Response> => {
  const recoveryKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const recoveryKeyDid = await recoveryKey.exportPublicKey("did");
  const inviteCode = overrides.inviteCode ?? (await createInviteCode());
  return request("/xrpc/com.atproto.server.createAccount", {
    body: JSON.stringify({
      handle: "agent.pds.test",
      inviteCode,
      password: PASSWORD,
      recoveryKey: recoveryKeyDid,
      ...overrides,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
};

describe("com.atproto.server.createAccount", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a control-plane invite and creates an account session", async () => {
    const inviteCode = await createInviteCode();
    const response = await postAccount({ inviteCode });
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
    const inviteCodes = new InviteCodeRepository(env.PDS_KV);
    const [account, resolvedDid, storedRefreshToken, inviteCodeExists, repo] =
      await Promise.all([
        env.PDS_DB.prepare(
          "SELECT did, handle, password_hash FROM accounts WHERE did = ?"
        )
          .bind(payload.did)
          .first(),
        handleResponse.text(),
        env.PDS_DB.prepare(
          "SELECT did, jti, expires_at FROM refresh_tokens WHERE did = ?"
        )
          .bind(payload.did)
          .first(),
        inviteCodes.exists(inviteCode),
        repoObject.rpcGetRepoStatus(),
      ]);
    expect({
      account,
      handleContentType: handleResponse.headers.get("Content-Type"),
      handleStatus: handleResponse.status,
      inviteCodeExists,
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
      inviteCodeExists: false,
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

  it("generates invite codes that expire after two hours", async () => {
    const generatedAt = Math.floor(Date.now() / 1000);
    const inviteCode = await createInviteCode();
    const inviteCodes = new InviteCodeRepository(env.PDS_KV);
    const listed = await env.PDS_KV.list();
    const storedInvite = listed.keys.find(({ name }) =>
      name.endsWith(inviteCode)
    );

    expect(inviteCode).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    await expect(inviteCodes.exists(inviteCode)).resolves.toBeTruthy();
    expect(storedInvite?.expiration).toBeGreaterThanOrEqual(
      generatedAt + 2 * 60 * 60
    );
    expect(storedInvite?.expiration).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + 2 * 60 * 60
    );
  });

  it("rejects a handle that already has an account", async () => {
    const handle = "duplicate.pds.test";
    const first = await postAccount({ handle });
    expect(first.status).toBe(200);

    const duplicate = await postAccount({ handle });
    expect(duplicate.status).toBe(400);
    await expect(duplicate.text()).resolves.toBe("Handle is not available");
  });

  it("rejects an invite not issued by the control plane", async () => {
    const response = await postAccount({
      handle: "unsigned.pds.test",
      inviteCode: "not-issued-by-the-control-plane",
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid invite code");
  });

  it("rejects an invite after successful use", async () => {
    const inviteCode = await createInviteCode();
    const first = await postAccount({
      handle: "invite-first.pds.test",
      inviteCode,
    });
    expect(first.status).toBe(200);

    const second = await postAccount({
      handle: "invite-second.pds.test",
      inviteCode,
    });
    expect(second.status).toBe(400);
    await expect(second.text()).resolves.toBe("Invalid invite code");
  });

  it("returns the created account when invite deletion fails", async () => {
    const deleteError = new Error("KV delete failed");
    const deleteInvite = vi
      .spyOn(InviteCodeRepository.prototype, "delete")
      .mockRejectedValueOnce(deleteError);
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await postAccount({ handle: "delete-failure.pds.test" });

    expect(response.status).toBe(200);
    expect(
      createAccountResponseSchema.parse(await response.json())
    ).toMatchObject({ handle: "delete-failure.pds.test" });
    expect(deleteInvite).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(
      "failed to delete used invite code",
      deleteError
    );
  });

  it("rejects account imports and requires local credentials", async () => {
    const importedAccount = await postAccount({ did: "did:plc:alice" });
    expect(importedAccount.status).toBe(400);

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

  it("requires a 2-63 character account name", async () => {
    const shortAccountName = await postAccount({ handle: "a.pds.test" });
    expect(shortAccountName.status).toBe(400);

    const longAccountName = await postAccount({
      handle: `${"a".repeat(64)}.pds.test`,
    });
    expect(longAccountName.status).toBe(400);
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
