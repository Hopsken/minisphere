import { parseDidKey, Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { deriveDidFromGenesisOp, signOperation } from "@atcute/did-plc";
import type {
  DidKeyString,
  Operation,
  UnsignedOperation,
} from "@atcute/did-plc";
import { env, exports } from "cloudflare:workers";
import { jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import z from "zod";

const REQUEST_ORIGIN = "https://service-binding.test";

const request = (path: string, init?: RequestInit): Promise<Response> =>
  exports.default.fetch(new Request(`${REQUEST_ORIGIN}${path}`, init));

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
  plcOp?: Operation;
  recoveryKey?: string;
}

const createInviteCode = (): Promise<string> =>
  exports.PdsControlPlane.generateInviteCode();

const normalizeDidKey = (value: string): DidKeyString => {
  parseDidKey(value);
  return `did:key:${value.slice("did:key:".length)}`;
};

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
      recoveryKey: recoveryKeyDid,
      ...overrides,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
};

const prepareEntrywayAccount = async (handle: string) => {
  const reservation = await request(
    "/xrpc/com.atproto.server.reserveSigningKey",
    {
      body: "{}",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }
  );
  const { signingKey: signingKeyInput } = z
    .object({ signingKey: z.string() })
    .parse(await reservation.json());
  const signingKey = normalizeDidKey(signingKeyInput);
  const rotationKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const operation: UnsignedOperation = {
    alsoKnownAs: [`at://${handle}`],
    prev: null,
    rotationKeys: [await rotationKey.exportPublicKey("did")],
    services: {
      atproto_pds: {
        endpoint: "https://pds.test",
        type: "AtprotoPersonalDataServer",
      },
    },
    type: "plc_operation",
    verificationMethods: { atproto: signingKey },
  };
  const plcOp = await signOperation(operation, rotationKey);
  return { did: await deriveDidFromGenesisOp(plcOp), handle, plcOp };
};

describe("com.atproto.server.createAccount", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a control-plane invite and creates a passwordless account", async () => {
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

    const repoObject = env.REPO.getByName(payload.did);
    const [account, accountColumns, storedRefreshToken, invitation, repo] =
      await Promise.all([
        env.PDS_DB.prepare("SELECT did FROM accounts WHERE did = ?")
          .bind(payload.did)
          .first(),
        env.PDS_DB.prepare("PRAGMA table_info(accounts)").all<{
          name: string;
        }>(),
        env.PDS_DB.prepare(
          "SELECT did, jti, expires_at FROM refresh_tokens WHERE did = ?"
        )
          .bind(payload.did)
          .first(),
        env.PDS_DB.prepare(
          "SELECT code FROM account_invitations WHERE code = ?"
        )
          .bind(inviteCode)
          .first(),
        repoObject.rpcGetRepoStatus(),
      ]);
    expect({
      account,
      accountColumns: accountColumns.results.map(({ name }) => name),
      invitation,
      repo,
      storedRefreshToken,
    }).toMatchObject({
      account: {
        did: payload.did,
      },
      accountColumns: ["did"],
      invitation: null,
      repo: {
        did: payload.did,
        head: expect.any(String),
        rev: expect.any(String),
      },
      storedRefreshToken: {
        did: payload.did,
        expires_at: expect.any(Number),
        jti: refreshClaims.jti,
      },
    });
  });

  it("accepts an Entryway-derived DID and PLC operation", async () => {
    const input = await prepareEntrywayAccount("entryway.pds.test");
    const inviteCode = await createInviteCode();
    const response = await request("/xrpc/com.atproto.server.createAccount", {
      body: JSON.stringify({ ...input, inviteCode }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    const account = createAccountResponseSchema.parse(await response.json());
    expect(account).toMatchObject({ did: input.did, handle: input.handle });

    const [repoStatus, plcState] = await Promise.all([
      request(
        `/xrpc/com.atproto.sync.getRepoStatus?did=${encodeURIComponent(input.did)}`
      ),
      env.DIRECTORY.fetch(
        new Request(
          `https://minisphere-directory.service/${encodeURIComponent(input.did)}/data`
        )
      ),
    ]);
    await expect(repoStatus.json()).resolves.toStrictEqual({
      active: true,
      did: input.did,
      rev: expect.any(String),
    });
    await expect(plcState.json()).resolves.toMatchObject({
      alsoKnownAs: [`at://${input.handle}`],
      did: input.did,
      verificationMethods: input.plcOp.verificationMethods,
    });
    await expect(
      env.PDS_DB.prepare("SELECT code FROM account_invitations WHERE code = ?")
        .bind(inviteCode)
        .first()
    ).resolves.toBeNull();
  });

  it("requires an invite for a valid externally signed PLC operation", async () => {
    const input = await prepareEntrywayAccount("uninvited.pds.test");
    const response = await request("/xrpc/com.atproto.server.createAccount", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invite code is required");
  });

  it("rejects an invalid PLC operation even with an invite", async () => {
    const input = await prepareEntrywayAccount("invalid-operation.pds.test");
    const inviteCode = await createInviteCode();
    const replacement = input.plcOp.sig.startsWith("A") ? "B" : "A";
    const plcOp = {
      ...input.plcOp,
      sig: `${replacement}${input.plcOp.sig.slice(1)}`,
    };
    const response = await request("/xrpc/com.atproto.server.createAccount", {
      body: JSON.stringify({
        ...input,
        did: await deriveDidFromGenesisOp(plcOp),
        inviteCode,
        plcOp,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "DID and PLC operation do not match"
    );

    const retry = await postAccount({
      handle: "valid-after-invalid.pds.test",
      inviteCode,
    });
    expect(retry.status).toBe(200);
  });

  it("stores invite codes with a two-hour expiry", async () => {
    const generatedAt = Math.floor(Date.now() / 1000);
    const inviteCode = await createInviteCode();
    const storedInvite = await env.PDS_DB.prepare(
      "SELECT code, expires_at FROM account_invitations WHERE code = ?"
    )
      .bind(inviteCode)
      .first<{ code: string; expires_at: number }>();

    expect(inviteCode).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(storedInvite?.code).toBe(inviteCode);
    expect(storedInvite?.expires_at).toBeGreaterThanOrEqual(
      generatedAt + 2 * 60 * 60
    );
    expect(storedInvite?.expires_at).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + 2 * 60 * 60
    );
  });

  it("rejects and removes an expired invite", async () => {
    const inviteCode = await createInviteCode();
    await env.PDS_DB.prepare(
      "UPDATE account_invitations SET expires_at = 0 WHERE code = ?"
    )
      .bind(inviteCode)
      .run();

    const response = await postAccount({
      handle: "expired-invite.pds.test",
      inviteCode,
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid invite code");
    await expect(
      env.PDS_DB.prepare("SELECT code FROM account_invitations WHERE code = ?")
        .bind(inviteCode)
        .first()
    ).resolves.toBeNull();
  });

  it("removes unused expired invites when generating another invite", async () => {
    const inviteCode = await createInviteCode();
    await env.PDS_DB.prepare(
      "UPDATE account_invitations SET expires_at = 0 WHERE code = ?"
    )
      .bind(inviteCode)
      .run();

    await createInviteCode();

    await expect(
      env.PDS_DB.prepare("SELECT code FROM account_invitations WHERE code = ?")
        .bind(inviteCode)
        .first()
    ).resolves.toBeNull();
  });

  it("does not own handle uniqueness", async () => {
    const handle = "duplicate.pds.test";
    const first = await postAccount({ handle });
    const second = await postAccount({ handle });

    expect([first.status, second.status]).toStrictEqual([200, 200]);
    const firstAccount = createAccountResponseSchema.parse(await first.json());
    const secondAccount = createAccountResponseSchema.parse(
      await second.json()
    );
    expect(firstAccount.did).not.toBe(secondAccount.did);
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

  it("allows only one concurrent request to claim an invite", async () => {
    const inviteCode = await createInviteCode();
    const accountCountBefore =
      (await env.PDS_DB.prepare(
        "SELECT count(*) AS count FROM accounts"
      ).first<number>("count")) ?? 0;
    const responses = await Promise.all([
      postAccount({ handle: "concurrent-first.pds.test", inviteCode }),
      postAccount({ handle: "concurrent-second.pds.test", inviteCode }),
    ]);

    expect(responses.map(({ status }) => status).toSorted()).toStrictEqual([
      200, 400,
    ]);
    await expect(
      Promise.all(
        responses
          .filter(({ status }) => status === 400)
          .map((response) => response.text())
      )
    ).resolves.toStrictEqual(["Invalid invite code"]);
    await expect(
      env.PDS_DB.prepare(
        "SELECT count(*) AS count FROM accounts"
      ).first<number>("count")
    ).resolves.toBe(accountCountBefore + 1);
  });

  it("keeps an invite spent when account creation later fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const inviteCode = await createInviteCode();

    const failed = await postAccount({
      handle: "directory-failure.pds.test",
      inviteCode,
    });
    expect(failed.status).toBe(500);

    const retry = await postAccount({
      handle: "retry-after-failure.pds.test",
      inviteCode,
    });
    expect(retry.status).toBe(400);
    await expect(retry.text()).resolves.toBe("Invalid invite code");
  });

  it("rejects account imports and primary passwords", async () => {
    const importedAccount = await postAccount({ did: "did:plc:alice" });
    expect(importedAccount.status).toBe(400);

    const primaryPassword = await postAccount({
      handle: "password.pds.test",
      password: "primary-password-is-not-supported",
    });
    expect(primaryPassword.status).toBe(400);

    const invalidRecoveryKey = await postAccount({
      handle: "recovery.pds.test",
      recoveryKey: "not-a-key",
    });
    expect(invalidRecoveryKey.status).toBe(400);
  });

  it("accepts a valid handle outside the PDS domain", async () => {
    const response = await postAccount({ handle: "agent.example.com" });

    expect(response.status).toBe(200);
    expect(
      createAccountResponseSchema.parse(await response.json())
    ).toMatchObject({ handle: "agent.example.com" });
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

  it("does not publish handle mappings", async () => {
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
