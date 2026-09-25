import * as SubscribeRepos from "@atcute/atproto/types/sync/subscribeRepos";
import { fromBytes } from "@atcute/cbor";
import { parseDidKey, Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { deriveDidFromGenesisOp, signOperation } from "@atcute/did-plc";
import type {
  DidKeyString,
  Operation,
  UnsignedOperation,
} from "@atcute/did-plc";
import { parse } from "@atcute/lexicons/validations";
import { readCarWithRoot } from "@atproto/repo";
import { env, exports } from "cloudflare:workers";
import { jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import z from "zod";

import { aboutRepo, subscribe } from "./firehose-client";

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
}

const createInviteCode = (): Promise<string> =>
  exports.PdsControlPlane.generateInviteCode();

const normalizeDidKey = (value: string): DidKeyString => {
  parseDidKey(value);
  return `did:key:${value.slice("did:key:".length)}`;
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

const postAccount = async (
  overrides: CreateAccountOverrides = {}
): Promise<Response> => {
  const input = await prepareEntrywayAccount(
    overrides.handle ?? "agent.pds.test"
  );
  const inviteCode = overrides.inviteCode ?? (await createInviteCode());
  return request("/xrpc/com.atproto.server.createAccount", {
    body: JSON.stringify({ ...input, inviteCode, ...overrides }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
};

describe("com.atproto.server.createAccount", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a trusted provisioning invite and creates a passwordless account", async () => {
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

    const repoStatus = await request(
      `/xrpc/com.atproto.sync.getRepoStatus?did=${encodeURIComponent(payload.did)}`
    );
    await expect(repoStatus.json()).resolves.toStrictEqual({
      active: true,
      did: payload.did,
      rev: expect.any(String),
    });
  });

  it("registers the Entryway-derived DID and PLC operation", async () => {
    const input = await prepareEntrywayAccount("entryway.pds.test");
    const response = await request("/xrpc/com.atproto.server.createAccount", {
      body: JSON.stringify({ ...input, inviteCode: await createInviteCode() }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(
      createAccountResponseSchema.parse(await response.json())
    ).toMatchObject({ did: input.did, handle: input.handle });
    const [repoStatus, plcState] = await Promise.all([
      request(
        `/xrpc/com.atproto.sync.getRepoStatus?did=${encodeURIComponent(input.did)}`
      ),
      fetch(
        new Request(
          `${env.PLC_DIRECTORY}/${encodeURIComponent(input.did)}/data`
        )
      ),
    ]);
    await expect(
      Promise.all([repoStatus.json(), plcState.json()])
    ).resolves.toStrictEqual([
      { active: true, did: input.did, rev: expect.any(String) },
      expect.objectContaining({
        alsoKnownAs: [`at://${input.handle}`],
        did: input.did,
        verificationMethods: input.plcOp.verificationMethods,
      }),
    ]);
  });

  it("announces the account identity, status, and commit to relays", async () => {
    const firehose = await subscribe();
    const response = await postAccount({ handle: "announced.pds.test" });
    const { did } = createAccountResponseSchema.parse(await response.json());
    const [identity, account, sync] = await firehose.take(3, aboutRepo(did));
    firehose.close();
    const head = await env.REPO.getByName(did).rpcGetRepoStatus();
    const syncEvent = parse(SubscribeRepos.syncSchema, sync?.body);
    const car = await readCarWithRoot(fromBytes(syncEvent.blocks));
    expect({
      account: parse(SubscribeRepos.accountSchema, account?.body),
      headers: [identity, account, sync].map((frame) => frame?.header),
      identity: parse(SubscribeRepos.identitySchema, identity?.body),
      sync: { rev: syncEvent.rev, root: car.root.toString() },
    }).toMatchObject({
      account: { active: true, did },
      headers: [
        { op: 1, t: "#identity" },
        { op: 1, t: "#account" },
        { op: 1, t: "#sync" },
      ],
      identity: { did, handle: "announced.pds.test" },
      sync: { rev: head.rev, root: head.head },
    });
  });

  it("requires a non-empty invite", async () => {
    const input = await prepareEntrywayAccount("uninvited.pds.test");
    const response = await request("/xrpc/com.atproto.server.createAccount", {
      body: JSON.stringify({ ...input, inviteCode: "" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
  });

  it("rejects an expired invite", async () => {
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

  it("rejects an invite not issued by the provisioning entrypoint", async () => {
    const input = await prepareEntrywayAccount("unsigned.pds.test");
    const createWith = (inviteCode: string) =>
      request("/xrpc/com.atproto.server.createAccount", {
        body: JSON.stringify({ ...input, inviteCode }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

    const rejected = await createWith(
      "not-issued-by-the-provisioning-entrypoint"
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.text()).resolves.toBe("Invalid invite code");

    // The rejected request must not consume the signing-key reservation.
    const accepted = await createWith(await createInviteCode());
    expect(accepted.status).toBe(200);
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
    const inputs = await Promise.all([
      prepareEntrywayAccount("concurrent-first.pds.test"),
      prepareEntrywayAccount("concurrent-second.pds.test"),
    ]);
    const responses = await Promise.all(
      inputs.map((input) =>
        request("/xrpc/com.atproto.server.createAccount", {
          body: JSON.stringify({ ...input, inviteCode }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        })
      )
    );

    expect(responses.map(({ status }) => status).toSorted()).toStrictEqual([
      200, 400,
    ]);
    const repoStatuses = await Promise.all(
      inputs.map((input) =>
        request(
          `/xrpc/com.atproto.sync.getRepoStatus?did=${encodeURIComponent(input.did)}`
        )
      )
    );
    const active = await Promise.all(
      repoStatuses.map(async (status) =>
        z.object({ active: z.boolean() }).parse(await status.json())
      )
    );
    expect(active.map((status) => status.active)).toStrictEqual(
      responses.map(({ status }) => status === 200)
    );
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

  it("ignores standard account fields unused by Entryway", async () => {
    const response = await postAccount({
      handle: "password.pds.test",
      password: "primary-password-is-not-supported",
    });
    expect(response.status).toBe(200);
  });

  it("accepts a valid handle outside the PDS domain", async () => {
    const response = await postAccount({ handle: "agent.example.com" });

    expect(response.status).toBe(200);
    expect(
      createAccountResponseSchema.parse(await response.json())
    ).toMatchObject({ handle: "agent.example.com" });
  });
});
