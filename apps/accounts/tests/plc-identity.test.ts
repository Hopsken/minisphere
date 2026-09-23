import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import {
  deriveDidFromGenesisOp,
  isSignedOperationValid,
} from "@atcute/did-plc";
import { env, withEnv } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PdsClient } from "../worker/clients/pds-client";
import { PdsResponseError } from "../worker/clients/pds-response-error";
import { PlcDirectoryClient } from "../worker/clients/plc-directory-client";
import { createDatabase } from "../worker/db";
import {
  createPlcAccountMaterial,
  restorePlcAccountMaterial,
} from "../worker/lib/plc-account";
import { UserRepository } from "../worker/repositories/user-repository";
import { AccountService } from "../worker/services/account";

const users = () => new UserRepository(createDatabase(env.DB));
const candidate = async (userId: string, username: string) => {
  const key = await Secp256k1PrivateKeyExportable.createKeypair();
  return createPlcAccountMaterial(
    userId,
    env.ACCOUNTS_ENCRYPTION_KEY,
    `${username}.minisphere.test`,
    "https://pds.test",
    await key.exportPublicKey("did")
  );
};

const flip = (value: string) =>
  `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;

describe("durable per-account PLC identity", () => {
  afterEach(() => vi.restoreAllMocks());

  it("generates distinct keys and validates signed genesis operations", async () => {
    const [alice, bob] = await Promise.all([
      candidate("alice", "alice"),
      candidate("bob", "bob"),
    ]);
    expect(alice.operation.rotationKeys).not.toStrictEqual(
      bob.operation.rotationKeys
    );
    expect(alice.rotationKeyIv).not.toBe(bob.rotationKeyIv);
    await Promise.all(
      (
        [
          ["alice", alice],
          ["bob", bob],
        ] as const
      ).map(async ([id, material]) => {
        await expect(deriveDidFromGenesisOp(material.operation)).resolves.toBe(
          material.did
        );
        await expect(
          isSignedOperationValid(
            material.operation.rotationKeys,
            material.operation
          )
        ).resolves.toBe(material.operation.rotationKeys[0]);
        await expect(
          restorePlcAccountMaterial(id, env.ACCOUNTS_ENCRYPTION_KEY, material)
        ).resolves.toStrictEqual({
          did: material.did,
          operation: material.operation,
          signingKey: material.signingKey,
        });
      })
    );
  });

  it("rejects ciphertext, IV, account AAD, secret, and signed operation changes", async () => {
    const material = await candidate("tamper", "tamper");
    await Promise.all(
      [
        {
          ...material,
          encryptedRotationKey: flip(material.encryptedRotationKey),
        },
        { ...material, rotationKeyIv: flip(material.rotationKeyIv) },
        {
          ...material,
          operation: {
            ...material.operation,
            alsoKnownAs: ["at://attacker.test"],
          },
        },
      ].map(async (changed) => {
        await expect(
          restorePlcAccountMaterial(
            "tamper",
            env.ACCOUNTS_ENCRYPTION_KEY,
            changed
          )
        ).rejects.toThrow(/./u);
      })
    );
    await expect(
      restorePlcAccountMaterial(
        "another-account",
        env.ACCOUNTS_ENCRYPTION_KEY,
        material
      )
    ).rejects.toThrow(/./u);
    await expect(
      restorePlcAccountMaterial(
        "tamper",
        "a-different-secret-with-at-least-32-characters",
        material
      )
    ).rejects.toThrow(/./u);
  });

  it("atomically selects one complete candidate across independent database sessions", async () => {
    const id = crypto.randomUUID();
    await users().reserveAccount(id, "candidate-race");
    const candidates = await Promise.all([
      candidate(id, "candidate-race"),
      candidate(id, "candidate-race"),
    ]);
    const [first, second] = await Promise.all(
      candidates.map((material) =>
        users().saveProvisioningIdentity(id, "candidate-race", material)
      )
    );
    expect(first).toStrictEqual(second);
    const winner = candidates.find((material) => material.did === first?.did);
    if (!winner) {
      throw new Error("Neither complete candidate was saved");
    }
    expect(first).toMatchObject(winner);
    await users().releaseEmptyProvisioningAccount(id, "candidate-race");
    await expect(users().findAccountByUserId(id)).resolves.toStrictEqual(first);
    await users().activateAccount(id, first?.did ?? "missing");
    const active = await users().findAccountByUserId(id);
    expect(active).toMatchObject({ ...winner, status: "active" });
    await users().saveProvisioningIdentity(id, "candidate-race", candidates[0]);
    await expect(users().findAccountByUserId(id)).resolves.toStrictEqual(
      active
    );
  });

  it("does not save or clean up a replacement username reservation", async () => {
    const id = crypto.randomUUID();
    await users().reserveAccount(id, "old-name");
    const old = await candidate(id, "old-name");
    await users().releaseEmptyProvisioningAccount(id, "old-name");
    await users().reserveAccount(id, "new-name");
    await users().saveProvisioningIdentity(id, "old-name", old);
    await users().releaseEmptyProvisioningAccount(id, "old-name");
    await expect(users().findAccountByUserId(id)).resolves.toMatchObject({
      did: null,
      username: "new-name",
    });
  });

  it("reuses the stored operation after service restart and configuration changes", async () => {
    const id = crypto.randomUUID();
    const material = await candidate(id, "restart");
    await users().reserveAccount(id, "restart");
    await users().saveProvisioningIdentity(id, "restart", material);
    const reserve = vi.spyOn(PdsClient.prototype, "reserveSigningKey");
    vi.spyOn(PdsClient.prototype, "getRepoStatus").mockResolvedValue({
      active: false,
      did: material.did,
    });
    vi.spyOn(PdsClient.prototype, "generateInviteCode").mockResolvedValue(
      "test-invite"
    );
    const create = vi
      .spyOn(PdsClient.prototype, "createAccount")
      .mockRejectedValue(new Error("Unknown outcome"));
    await new AccountService(users(), env).createAccount(id, "restart");
    await withEnv({ ...env, PDS_ORIGIN: "https://changed.test" }, () =>
      new AccountService(users(), env).createAccount(id, "restart")
    );
    const expectedInput = {
      did: material.did,
      handle: "restart.minisphere.test",
      inviteCode: "test-invite",
      plcOp: material.operation,
    };
    expect(create.mock.calls).toStrictEqual([[expectedInput], [expectedInput]]);
    await env.DB.prepare(
      "UPDATE atproto_account SET encrypted_rotation_key = ? WHERE user_id = ?"
    )
      .bind("AAAA", id)
      .run();
    await expect(
      new AccountService(users(), env).createAccount(id, "restart")
    ).rejects.toThrow(/./u);
    expect(create).toHaveBeenCalledTimes(2);
    expect(reserve).not.toHaveBeenCalled();
    await expect(users().findAccountByUserId(id)).resolves.toMatchObject({
      did: material.did,
      encryptedRotationKey: "AAAA",
    });
  });

  it("keeps the winner when one concurrent create fails before the other completes", async () => {
    const id = crypto.randomUUID();
    const material = await candidate(id, "create-race");
    vi.spyOn(PdsClient.prototype, "reserveSigningKey").mockResolvedValue(
      material.signingKey
    );
    let ready = false;
    vi.spyOn(PdsClient.prototype, "getRepoStatus").mockImplementation((did) =>
      Promise.resolve({ active: ready, did })
    );
    vi.spyOn(PdsClient.prototype, "generateInviteCode").mockResolvedValue(
      "test-invite"
    );
    const started = Promise.withResolvers<null>();
    const finish = Promise.withResolvers<null>();
    const create = vi
      .spyOn(PdsClient.prototype, "createAccount")
      .mockImplementationOnce(async (input) => {
        started.resolve(null);
        await finish.promise;
        ready = true;
        return {
          accessJwt: "unused",
          did: input.did,
          handle: input.handle,
          refreshJwt: "unused",
        };
      })
      .mockRejectedValueOnce(new PdsResponseError(400, "rejected"));
    vi.spyOn(PlcDirectoryClient.prototype, "getState").mockImplementation(
      async (did) => {
        const row = await users().findAccountByUserId(id);
        if (!row?.operation) {
          throw new Error("Missing operation");
        }
        return { ...row.operation, did };
      }
    );
    const first = new AccountService(users(), env).createAccount(
      id,
      "create-race"
    );
    await started.promise;
    const before = await users().findAccountByUserId(id);
    await expect(
      new AccountService(users(), env).createAccount(id, "create-race")
    ).rejects.toThrow("PDS account creation failed");
    await expect(users().findAccountByUserId(id)).resolves.toStrictEqual(
      before
    );
    finish.resolve(null);
    await expect(first).resolves.toMatchObject({
      did: before?.did,
      state: "active",
    });
    expect(create.mock.calls[0]?.[0].plcOp).toStrictEqual(
      create.mock.calls[1]?.[0].plcOp
    );
    await expect(users().findAccountByUserId(id)).resolves.toMatchObject({
      encryptedRotationKey: before?.encryptedRotationKey,
      status: "active",
    });
  });
});
