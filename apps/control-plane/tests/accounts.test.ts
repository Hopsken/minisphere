import { parsePrivateMultikey } from "@atcute/crypto";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import z from "zod";

import { PdsAccountError } from "../worker/accounts/pds-client";
import {
  AccountAlreadyExistsError,
  createManagedAccount,
} from "../worker/accounts/service";
import { decryptText } from "../worker/crypto/encryption";

const ORIGIN = "https://control-plane.test";
const PDS_ORIGIN = "https://pds.test";
const INVITE_CODE = "test-invite";
const generateInviteCode = (): Promise<string> => Promise.resolve(INVITE_CODE);

const createAccountRequestSchema = z.object({
  handle: z.string(),
  inviteCode: z.string(),
  password: z.string(),
  recoveryKey: z.string(),
});
type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;

const storedCredentialsSchema = z.object({
  accessJwt: z.string(),
  password: z.string(),
  recoveryKey: z.string(),
  refreshJwt: z.string(),
});

interface StoredAccount {
  did: string;
  encrypted_credentials: string;
  handle: string;
  pds_origin: string;
}

const request = (path: string, init?: RequestInit): Promise<Response> =>
  exports.default.fetch(new Request(`${ORIGIN}${path}`, init));

const createSuccessfulPds =
  (
    did: `did:${string}:${string}`,
    received: CreateAccountRequest[]
  ): typeof globalThis.fetch =>
  async (input, init) => {
    const pdsRequest = new Request(input, init);
    expect(pdsRequest.method).toBe("POST");
    expect(pdsRequest.url).toBe(
      `${PDS_ORIGIN}/xrpc/com.atproto.server.createAccount`
    );
    const body = createAccountRequestSchema.parse(await pdsRequest.json());
    received.push(body);
    return Response.json({
      accessJwt: `access-${did}`,
      did,
      handle: body.handle,
      refreshJwt: `refresh-${did}`,
    });
  };

const rejectingPds: typeof globalThis.fetch = () =>
  Promise.resolve(
    Response.json(
      {
        error: "HandleNotAvailable",
        message: "Handle is not available",
      },
      { status: 400 }
    )
  );

const readStoredAccount = async (did: string): Promise<StoredAccount> => {
  const account = await env.DB.prepare(
    `SELECT did, handle, pds_origin, encrypted_credentials
     FROM accounts WHERE did = ?`
  )
    .bind(did)
    .first<StoredAccount>();
  if (!account) {
    throw new Error("Expected a stored account");
  }
  return account;
};

describe("managed accounts", () => {
  it("creates an account with a PDS invite and encrypted credentials", async () => {
    const received: CreateAccountRequest[] = [];
    const did = "did:plc:account00000000000000000";
    const account = await createManagedAccount(
      { name: "atlas" },
      env,
      createSuccessfulPds(did, received),
      generateInviteCode
    );

    expect(account).toMatchObject({
      did,
      handle: "atlas.pds.test",
      pdsOrigin: PDS_ORIGIN,
    });
    expect(received).toHaveLength(1);
    const [createRequest] = received;
    if (!createRequest) {
      throw new Error("Expected a PDS createAccount request");
    }
    expect(createRequest).toMatchObject({
      handle: "atlas.pds.test",
      password: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      recoveryKey: expect.stringMatching(/^did:key:/u),
    });
    expect(createRequest.inviteCode).toBe(INVITE_CODE);

    const stored = await readStoredAccount(did);
    const serializedCredentials = await decryptText(
      stored.encrypted_credentials,
      env.CONTROL_PLANE_ENCRYPTION_KEY,
      did
    );
    const credentials = storedCredentialsSchema.parse(
      JSON.parse(serializedCredentials)
    );
    expect({
      credentials,
      recoveryKeyType: parsePrivateMultikey(credentials.recoveryKey).type,
      stored,
    }).toMatchObject({
      credentials: {
        accessJwt: `access-${did}`,
        password: createRequest.password,
        recoveryKey: expect.stringMatching(/^z/u),
        refreshJwt: `refresh-${did}`,
      },
      recoveryKeyType: "secp256k1",
      stored: {
        did,
        encrypted_credentials: expect.not.stringContaining(
          createRequest.password
        ),
        handle: "atlas.pds.test",
        pds_origin: PDS_ORIGIN,
      },
    });
  });

  it("does not write an account when the PDS rejects creation", async () => {
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM accounts"
    ).first<{ count: number }>();

    await expect(
      createManagedAccount(
        { name: "taken" },
        env,
        rejectingPds,
        generateInviteCode
      )
    ).rejects.toBeInstanceOf(PdsAccountError);
    const result = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM accounts"
    ).first<{ count: number }>();
    expect(result?.count).toBe(before?.count);
  });

  it("rejects a handle that is already managed before calling the PDS", async () => {
    const received: CreateAccountRequest[] = [];
    const firstPds = createSuccessfulPds(
      "did:plc:first0000000000000000000",
      received
    );
    await createManagedAccount(
      { name: "duplicate" },
      env,
      firstPds,
      generateInviteCode
    );

    await expect(
      createManagedAccount(
        { name: "duplicate" },
        env,
        () => {
          throw new Error("PDS must not be called for a managed handle");
        },
        generateInviteCode
      )
    ).rejects.toBeInstanceOf(AccountAlreadyExistsError);
    expect(received).toHaveLength(1);
  });
});

describe("accounts API", () => {
  it("lists and reads managed accounts", async () => {
    const received: CreateAccountRequest[] = [];
    const did = "did:plc:api000000000000000000000";
    const account = await createManagedAccount(
      { name: "api-account" },
      env,
      createSuccessfulPds(did, received),
      generateInviteCode
    );
    const [listResponse, detailResponse] = await Promise.all([
      request("/api/accounts"),
      request(`/api/accounts/${encodeURIComponent(did)}`),
    ]);

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      accounts: expect.arrayContaining([account]),
    });
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toStrictEqual({ account });
  });

  it("returns public configuration and account endpoints", async () => {
    const [config, accounts, missing] = await Promise.all([
      request("/api/config"),
      request("/api/accounts"),
      request("/api/accounts/did%3Aplc%3Amissing"),
    ]);

    expect(config.status).toBe(200);
    await expect(config.json()).resolves.toStrictEqual({
      pdsHostname: "pds.test",
      pdsOrigin: PDS_ORIGIN,
    });
    expect(accounts.status).toBe(200);
    await expect(accounts.json()).resolves.toMatchObject({
      accounts: expect.any(Array),
    });
    expect(missing.status).toBe(404);
  });

  it("validates account creation before contacting the PDS", async () => {
    const response = await request("/api/accounts", {
      body: JSON.stringify({ name: "Invalid.Name" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
  });
});
