import { Client, simpleFetchHandler } from "@atcute/client";
import { env, exports } from "cloudflare:workers";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import z from "zod";

import { createDatabase } from "../worker/db";
import { AccountService } from "../worker/services/account-service";

const ORIGIN = "https://control-plane.test";
const PDS_ORIGIN = "https://pds.test";
const INVITE_CODE = "test-invite";

const createAccountRequestSchema = z.strictObject({
  handle: z.string(),
  inviteCode: z.string(),
  recoveryKey: z.string(),
});
type CreateAccountRequest = z.infer<typeof createAccountRequestSchema>;

interface StoredAccount {
  created_at: number;
  did: string;
}

const fetchApi = (path: string, init?: RequestInit): Promise<Response> =>
  exports.default.fetch(new Request(`${ORIGIN}${path}`, init));

const createPdsClient = (fetch: typeof globalThis.fetch): Client =>
  new Client({
    handler: simpleFetchHandler({ fetch, service: PDS_ORIGIN }),
  });

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
    `SELECT did, created_at
     FROM accounts WHERE did = ?`
  )
    .bind(did)
    .first<StoredAccount>();
  if (!account) {
    throw new Error("Expected a stored account");
  }
  return account;
};

describe("managed account service", () => {
  it("stores only the managed DID", async () => {
    const received: CreateAccountRequest[] = [];
    const did = "did:plc:account00000000000000000";
    const service = new AccountService(
      createDatabase(env.DB),
      createPdsClient(createSuccessfulPds(did, received))
    );

    const created = await service.createManagedAccount(env, {
      inviteCode: INVITE_CODE,
      name: "atlas",
    });

    expect({
      createdDid: created.did,
      requestCount: received.length,
    }).toStrictEqual({
      createdDid: did,
      requestCount: 1,
    });
    const [createRequest] = received;
    if (!createRequest) {
      throw new Error("Expected a PDS createAccount request");
    }
    expect(createRequest).toStrictEqual({
      handle: "atlas.r2d2.party",
      inviteCode: INVITE_CODE,
      recoveryKey: env.CONTROL_PLANE_ACCOUNT_RECOVERY_KEY,
    });

    const [stored, accountColumns] = await Promise.all([
      readStoredAccount(did),
      env.DB.prepare("PRAGMA table_info(accounts)").all<{ name: string }>(),
    ]);
    expect(stored).toMatchObject({
      created_at: expect.anything(),
      did,
    });
    expect(accountColumns.results.map(({ name }) => name)).toStrictEqual([
      "did",
      "created_at",
    ]);
    await expect(service.listManagedAccounts()).resolves.toContainEqual({
      did,
    });
  });

  it("does not store an account when the PDS rejects creation", async () => {
    const service = new AccountService(
      createDatabase(env.DB),
      createPdsClient(rejectingPds)
    );
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM accounts"
    ).first<{ count: number }>();

    await expect(
      service.createManagedAccount(env, {
        inviteCode: INVITE_CODE,
        name: "taken",
      })
    ).rejects.toBeInstanceOf(HTTPException);
    const result = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM accounts"
    ).first<{ count: number }>();
    expect(result?.count).toBe(before?.count);
  });
});

describe("accounts API", () => {
  it("lists managed DIDs", async () => {
    const did = "did:plc:api000000000000000000000";
    await env.DB.prepare("INSERT INTO accounts (did) VALUES (?)")
      .bind(did)
      .run();

    const response = await fetchApi("/api/accounts");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toContainEqual({ did });
  });

  it("validates account creation before calling service bindings", async () => {
    const response = await fetchApi("/api/accounts", {
      body: JSON.stringify({ name: "Invalid.Name" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(400);
  });
});
