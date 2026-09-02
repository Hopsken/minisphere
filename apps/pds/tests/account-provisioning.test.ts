import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const provisioningInput = async (
  handle: string,
  operationId = crypto.randomUUID()
) => {
  const recoveryKey = await Secp256k1PrivateKeyExportable.createKeypair();
  return {
    handle,
    operationId,
    recoveryKey: await recoveryKey.exportPublicKey("did"),
  };
};

describe("private Entryway account provisioning", () => {
  it("returns one DID when the same operation is retried", async () => {
    const input = await provisioningInput("entryway-one.pds.test");
    const first = await exports.PdsControlPlane.createAccount(input);
    const second = await exports.PdsControlPlane.createAccount(input);

    expect(first).toStrictEqual(second);
    expect(first).toMatchObject({
      did: expect.stringMatching(/^did:plc:/u),
      handle: input.handle,
      status: "active",
    });
    if (first.status !== "active") {
      throw new Error("Expected account creation to be active");
    }

    const [operations, accounts, repo] = await Promise.all([
      env.PDS_DB.prepare(
        "SELECT operation_id, handle, did, status FROM account_creation_operations WHERE operation_id = ?"
      )
        .bind(input.operationId)
        .all(),
      env.PDS_DB.prepare("SELECT did FROM accounts WHERE did = ?")
        .bind(first.did)
        .all(),
      env.REPO.getByName(first.did).rpcGetRepoStatus(),
    ]);
    expect(operations.results).toStrictEqual([
      {
        did: first.did,
        handle: input.handle,
        operation_id: input.operationId,
        status: "active",
      },
    ]);
    expect(accounts.results).toStrictEqual([{ did: first.did }]);
    expect(repo).toMatchObject({ did: first.did });
  });

  it("serializes concurrent retries without creating another DID", async () => {
    const input = await provisioningInput("entryway-concurrent.pds.test");
    const results = await Promise.all([
      exports.PdsControlPlane.createAccount(input),
      exports.PdsControlPlane.createAccount(input),
    ]);

    expect(results[0]).toStrictEqual(results[1]);
    const counts = await env.PDS_DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM account_creation_operations WHERE operation_id = ?) AS operations,
         (SELECT COUNT(*) FROM accounts WHERE did = ?) AS accounts`
    )
      .bind(
        input.operationId,
        results[0].status === "active" ? results[0].did : ""
      )
      .first<{ accounts: number; operations: number }>();
    expect(counts).toStrictEqual({ accounts: 1, operations: 1 });
  });

  it("confirms failure before a second operation can take the same handle", async () => {
    const firstInput = await provisioningInput("entryway-conflict.pds.test");
    const first = await exports.PdsControlPlane.createAccount(firstInput);
    const second = await exports.PdsControlPlane.createAccount(
      await provisioningInput("entryway-conflict.pds.test")
    );

    expect(first.status).toBe("active");
    expect(second).toStrictEqual({
      reason: "handle_unavailable",
      status: "failed",
    });
  });
});
