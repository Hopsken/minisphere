import * as CBOR from "@atcute/cbor";
import * as CID from "@atcute/cid";
import {
  P256PrivateKeyExportable,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import type { PrivateKey } from "@atcute/crypto";
import { processIndexedEntryLog, signOperation } from "@atcute/did-plc";
import type { IndexedEntry, Operation } from "@atcute/did-plc";
import { env, withEnv } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { patchPlcSchema } from "../schema/plc";
import { PlcDirectoryClient } from "../worker/clients/plc-directory-client";
import { createDatabase } from "../worker/db";
import app from "../worker/index";
import {
  createPlcAccountMaterial,
  decryptPlcRotationKey,
} from "../worker/lib/plc-account";
import { UserRepository } from "../worker/repositories/user-repository";
import { PlcService } from "../worker/services/plc";

const origin = "https://minisphere.test";
const operationCid = async (operation: Operation) =>
  CID.toString(await CID.create(CID.CODEC_DCBOR, CBOR.encode(operation)));

const signUpdate = (operation: Operation, key: PrivateKey) => {
  const { sig: _sig, ...unsigned } = operation;
  return signOperation(unsigned, key);
};

const fixture = async () => {
  const username = `plc-${crypto.randomUUID().slice(0, 8)}`;
  const login = await app.request(
    `${origin}/__dev/log-me-in/${username}@example.com`,
    {},
    env
  );
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  const user = await env.DB.prepare("SELECT id FROM user WHERE email = ?")
    .bind(`${username}@example.com`)
    .first<{ id: string }>();
  if (!user) {
    throw new Error("Missing test user");
  }
  const users = new UserRepository(createDatabase(env.DB));
  const repoKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const material = await createPlcAccountMaterial(
    user.id,
    env.ACCOUNTS_ENCRYPTION_KEY,
    `${username}.example.com`,
    "https://old-pds.example.com",
    await repoKey.exportPublicKey("did")
  );
  await users.reserveAccount(user.id, username);
  await users.saveProvisioningIdentity(user.id, username, material);
  await users.activateAccount(user.id, material.did);
  const key = await decryptPlcRotationKey(
    user.id,
    env.ACCOUNTS_ENCRYPTION_KEY,
    material
  );
  const managed = await key.exportPublicKey("did");
  const genesis = {
    cid: await operationCid(material.operation),
    createdAt: new Date().toISOString(),
    did: material.did,
    nullified: false,
    operation: material.operation,
  };
  const audit: IndexedEntry<Operation>[] = [genesis];
  const append = async (operation: Operation) => {
    const entry = {
      cid: await operationCid(operation),
      createdAt: new Date().toISOString(),
      did: material.did,
      nullified: false,
      operation,
    };
    const result = await processIndexedEntryLog(material.did, [
      genesis,
      ...audit.slice(1),
      entry,
    ]);
    for (const previous of audit) {
      previous.nullified = result.nullified.some(
        (item) => item.cid === previous.cid
      );
    }
    audit.push(entry);
    return entry;
  };
  const http = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe("GET");
      expect(request.url).toBe(
        `https://directory.test/${encodeURIComponent(material.did)}/log/audit`
      );
      return Promise.resolve(Response.json(audit));
    });
  const submit = vi
    .spyOn(PlcDirectoryClient.prototype, "submitOperation")
    .mockImplementation(async (did, operation) => {
      expect(did).toBe(material.did);
      await append(operation);
    });
  const directory = new PlcDirectoryClient("https://directory.test");
  const service = new PlcService(users, directory, env.ACCOUNTS_ENCRYPTION_KEY);
  const request = (
    body?: Record<string, string | string[] | boolean>,
    headers?: Record<string, string>
  ) =>
    app.request(
      `${origin}/api/account/plc`,
      {
        body: body === undefined ? null : JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          cookie,
          ...headers,
        },
        method: body === undefined ? "GET" : "PATCH",
      },
      env
    );
  return {
    append,
    audit,
    cookie,
    directory,
    genesis,
    http,
    key,
    managed,
    material,
    request,
    service,
    submit,
    user,
    users,
  };
};

describe("self-service PLC updates", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the configured PDS separately from the published endpoint", async () => {
    const f = await fixture();
    await withEnv(
      { ...env, PDS_ORIGIN: "https://configured.example.com" },
      async () => {
        const response = await f.request();
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
          expectedPdsEndpoint: "https://configured.example.com",
          services: {
            atproto_pds: { endpoint: "https://old-pds.example.com" },
          },
        });
      }
    );
    await withEnv({ ...env, PDS_ORIGIN: undefined }, async () => {
      const response = await f.request();
      await expect(response.json()).resolves.toMatchObject({
        expectedPdsEndpoint: "https://pds.minisphere.test",
      });
    });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it("requires a session for both methods", async () => {
    await Promise.all(
      ["GET", "PATCH"].map(async (method) => {
        const response = await app.request(
          `${origin}/api/account/plc`,
          { method },
          env
        );
        expect(response.status).toBe(401);
      })
    );
  });

  it("rejects cross-origin, same-site and missing Origin writes", async () => {
    const f = await fixture();
    await Promise.all(
      [
        { Origin: "https://evil.example.com" },
        { Origin: "null" },
        { Origin: "" },
        { Origin: origin, "Sec-Fetch-Site": "same-site" },
        { Origin: origin, "Sec-Fetch-Site": "cross-site" },
      ].map(async (headers) => {
        const response = await f.request(
          {
            expectedHead: f.genesis.cid,
            pdsEndpoint: "https://new.example.com",
          },
          headers
        );
        expect(response.status).toBe(403);
      })
    );
    expect(f.http).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it("uses only the session account and rejects a DID in the body", async () => {
    const f = await fixture();
    const response = await f.request({
      did: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
      expectedHead: f.genesis.cid,
      pdsEndpoint: "https://new.example.com",
    });
    expect(response.status).toBe(400);
    const other = await app.request(
      `${origin}/__dev/log-me-in/other-plc@example.com`,
      {},
      env
    );
    const cookie = other.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const otherRead = await f.request(undefined, { cookie });
    const otherWrite = await f.request(
      { expectedHead: f.genesis.cid, pdsEndpoint: "https://new.example.com" },
      { cookie }
    );
    expect([otherRead.status, otherWrite.status]).toStrictEqual([409, 409]);
    expect(f.http).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it("updates only PDS from the live head, preserves genesis, and does not expose key material", async () => {
    const f = await fixture();
    const extra = await P256PrivateKeyExportable.createKeypair();
    const live = await f.append(
      await signUpdate(
        {
          ...f.material.operation,
          alsoKnownAs: [
            "at://changed.example.com",
            "https://profile.example.com",
          ],
          prev: f.genesis.cid,
          services: {
            ...f.material.operation.services,
            other: {
              endpoint: "https://other.example.com",
              type: "OtherService",
            },
          },
          verificationMethods: {
            ...f.material.operation.verificationMethods,
            extra: await extra.exportPublicKey("did"),
          },
        },
        f.key
      )
    );
    const before = await f.users.findAccountByUserId(f.user.id);
    const read = await f.request();
    await expect(read.json()).resolves.toStrictEqual({
      alsoKnownAs: live.operation.alsoKnownAs,
      did: f.material.did,
      expectedPdsEndpoint: "https://pds.test",
      head: live.cid,
      rotationKeys: [f.managed],
      services: live.operation.services,
      verificationMethods: live.operation.verificationMethods,
    });
    const response = await f.request({
      expectedHead: live.cid,
      pdsEndpoint: "https://corrected.example.com",
    });
    expect({
      cache: read.headers.get("Cache-Control"),
      status: response.status,
    }).toStrictEqual({ cache: "no-store", status: 200 });
    const operation = f.submit.mock.calls[0]?.[1];
    expect(operation).toStrictEqual({
      ...live.operation,
      prev: live.cid,
      services: {
        ...f.material.operation.services,
        atproto_pds: {
          endpoint: "https://corrected.example.com",
          type: "AtprotoPersonalDataServer",
        },
        other: { endpoint: "https://other.example.com", type: "OtherService" },
      },
      sig: expect.any(String),
    });
    const body = await response.json();
    expect(body).toStrictEqual({
      alsoKnownAs: live.operation.alsoKnownAs,
      changed: true,
      did: f.material.did,
      expectedPdsEndpoint: "https://pds.test",
      head: f.audit.at(-1)?.cid,
      rotationKeys: [f.managed],
      services: operation?.services,
      verificationMethods: live.operation.verificationMethods,
    });
    await expect(f.users.findAccountByUserId(f.user.id)).resolves.toStrictEqual(
      before
    );
  });

  it("rejects rotation-key editing even with a confirmation field", async () => {
    const f = await fixture();
    const otherKey = await P256PrivateKeyExportable.createKeypair();
    const other = await otherKey.exportPublicKey("did");
    const input = {
      expectedHead: f.genesis.cid,
      pdsEndpoint: "https://new.example.com",
      rotationKeys: [other],
    };
    const rejected = await f.request(input);
    const confirmed = await f.request({
      ...input,
      confirmManagedKeyRemoval: true,
    });
    expect([rejected.status, confirmed.status]).toStrictEqual([400, 400]);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.audit).toHaveLength(1);
  });

  it("cannot sign after an external update removes the managed key", async () => {
    const f = await fixture();
    const otherKey = await P256PrivateKeyExportable.createKeypair();
    const other = await otherKey.exportPublicKey("did");
    const removed = await f.append(
      await signUpdate(
        {
          ...f.material.operation,
          prev: f.genesis.cid,
          rotationKeys: [other],
        },
        f.key
      )
    );
    await expect(
      f.service.patch(f.user.id, {
        expectedHead: removed.cid,
        pdsEndpoint: "https://new.example.com",
      })
    ).rejects.toMatchObject({
      message: "Managed key no longer has PLC update authority",
      status: 409,
    });
    const retry = await f.service.patch(f.user.id, {
      expectedHead: removed.cid,
      pdsEndpoint: "https://old-pds.example.com",
    });
    expect(retry.changed).toBeFalsy();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it("rejects high-priority managed signing to prevent accidental recovery", async () => {
    const f = await fixture();
    const lower = await Secp256k1PrivateKeyExportable.createKeypair();
    const lowerDid = await lower.exportPublicKey("did");
    const added = await f.append(
      await signUpdate(
        {
          ...f.material.operation,
          prev: f.genesis.cid,
          rotationKeys: [f.managed, lowerDid],
        },
        f.key
      )
    );
    const staleBase = f.audit.at(-1);
    if (!staleBase || staleBase.operation.type !== "plc_operation") {
      throw new Error("Missing base");
    }
    await expect(
      f.service.patch(f.user.id, {
        expectedHead: added.cid,
        pdsEndpoint: "https://new.example.com",
      })
    ).rejects.toMatchObject({
      message: "Managed key must have lowest priority for a safe PLC update",
      status: 409,
    });
    expect(f.submit).not.toHaveBeenCalled();
    // The protocol really would allow this stale-prev overwrite; the API must not.
    const lowerUpdate = await f.append(
      await signUpdate(
        {
          ...staleBase.operation,
          alsoKnownAs: ["at://lower.example.com"],
          prev: staleBase.cid,
        },
        lower
      )
    );
    await f.append(
      await signUpdate(
        {
          ...staleBase.operation,
          alsoKnownAs: ["at://recovery.example.com"],
          prev: staleBase.cid,
        },
        f.key
      )
    );
    expect(lowerUpdate.nullified).toBeTruthy();
    await expect(f.service.get(f.user.id)).resolves.toMatchObject({
      alsoKnownAs: ["at://recovery.example.com"],
    });
  });

  it("rejects stale heads even for no-op requests, and detects a race before submit", async () => {
    const f = await fixture();
    const added = await f.service.patch(f.user.id, {
      expectedHead: f.genesis.cid,
      pdsEndpoint: "https://new.example.com",
    });
    await expect(
      f.service.patch(f.user.id, {
        expectedHead: f.genesis.cid,
        pdsEndpoint: "https://new.example.com",
      })
    ).rejects.toMatchObject({ status: 409 });
    const read = await f.directory.getHead(f.material.did);
    const head = vi.spyOn(f.directory, "getHead").mockResolvedValueOnce(read);
    await f.append(
      await signUpdate(
        {
          ...read.operation,
          alsoKnownAs: ["at://race.example.com"],
          prev: added.head,
        },
        f.key
      )
    );
    await expect(
      f.service.patch(f.user.id, {
        expectedHead: added.head,
        pdsEndpoint: "https://another.example.com",
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(head).toHaveBeenCalledTimes(2);
    expect(f.submit).toHaveBeenCalledOnce();
  });

  it.each(["same", "higher"])(
    "does not recover over a %s-priority append after the final head check",
    async (priority) => {
      const f = await fixture();
      const higher = await P256PrivateKeyExportable.createKeypair();
      await f.append(
        await signUpdate(
          {
            ...f.material.operation,
            prev: f.genesis.cid,
            rotationKeys: [await higher.exportPublicKey("did"), f.managed],
          },
          f.key
        )
      );
      const base = await f.directory.getHead(f.material.did);
      f.submit.mockClear();
      f.submit.mockImplementationOnce(async (_did, operation) => {
        await f.append(
          await signUpdate(
            {
              ...base.operation,
              alsoKnownAs: ["at://winner.example.com"],
              prev: base.cid,
            },
            priority === "same" ? f.key : higher
          )
        );
        await f.append(operation);
      });
      await expect(
        f.service.patch(f.user.id, {
          expectedHead: base.cid,
          pdsEndpoint: "https://loser.example.com",
        })
      ).rejects.toMatchObject({ status: 409 });
      expect(f.audit).toHaveLength(3);
      await expect(f.service.get(f.user.id)).resolves.toMatchObject({
        alsoKnownAs: ["at://winner.example.com"],
      });
      expect(f.submit).toHaveBeenCalledOnce();
    }
  );

  it("reads back after a timeout and treats a later retry as a no-op", async () => {
    const f = await fixture();
    f.submit.mockImplementationOnce(async (_did, operation) => {
      await f.append(operation);
      throw new Error("Transport timeout with internal data");
    });
    const result = await f.service.patch(f.user.id, {
      expectedHead: f.genesis.cid,
      pdsEndpoint: "https://new.example.com",
    });
    expect(result.changed).toBeTruthy();
    const retried = await f.service.patch(f.user.id, {
      expectedHead: result.head,
      pdsEndpoint: "https://new.example.com",
    });
    expect(retried.changed).toBeFalsy();
    expect(f.submit).toHaveBeenCalledOnce();
    expect(f.audit).toHaveLength(2);
  });

  it("reports an unknown timeout outcome without retry or internal error disclosure", async () => {
    const f = await fixture();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    f.submit.mockRejectedValueOnce(
      new Error(`private payload ${f.material.encryptedRotationKey}`)
    );
    const response = await f.request({
      expectedHead: f.genesis.cid,
      pdsEndpoint: "https://new.example.com",
    });
    expect({
      body: await response.json(),
      status: response.status,
    }).toStrictEqual({
      body: {
        message:
          "PLC update outcome is unknown; read current state before retrying",
        status: 503,
      },
      status: 503,
    });
    expect(f.submit).toHaveBeenCalledOnce();
    f.http.mockRejectedValueOnce(new Error("sensitive directory payload"));
    const failedRead = await f.request();
    expect(failedRead.status).toBe(502);
    await expect(failedRead.json()).resolves.toStrictEqual({
      message: "PLC state is unavailable",
      status: 502,
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("fails closed for damaged encrypted keys without logging their contents", async () => {
    const f = await fixture();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await env.DB.prepare(
      "UPDATE atproto_account SET encrypted_rotation_key = ? WHERE user_id = ?"
    )
      .bind("invalid-private-ciphertext", f.user.id)
      .run();
    const response = await f.request({
      expectedHead: f.genesis.cid,
      pdsEndpoint: "https://new.example.com",
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toStrictEqual({
      message: "Managed PLC key is unavailable",
      status: 503,
    });
    expect(log).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it("does not accept a tampered audit CID or expose an unexpected database exception", async () => {
    const f = await fixture();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    f.genesis.cid = `b${"a".repeat(58)}`;
    const tampered = await f.request();
    expect(tampered.status).toBe(502);
    vi.spyOn(
      UserRepository.prototype,
      "findAccountByUserId"
    ).mockRejectedValueOnce(new Error("sensitive database error"));
    const failed = await f.request();
    expect({ body: await failed.json(), status: failed.status }).toStrictEqual({
      body: { message: "PLC request failed", status: 500 },
      status: 500,
    });
    expect(log).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it("does not retry when submission succeeds but verification is unavailable", async () => {
    const f = await fixture();
    f.submit.mockImplementationOnce(async (_did, operation) => {
      await f.append(operation);
      f.http.mockRejectedValueOnce(new Error("Read timeout"));
    });
    await expect(
      f.service.patch(f.user.id, {
        expectedHead: f.genesis.cid,
        pdsEndpoint: "https://new.example.com",
      })
    ).rejects.toMatchObject({ status: 502 });
    await expect(f.service.get(f.user.id)).resolves.toMatchObject({
      services: { atproto_pds: { endpoint: "https://new.example.com" } },
    });
    expect(f.submit).toHaveBeenCalledOnce();
  });

  it("submits JSON only to the selected directory with a timeout", async () => {
    const f = await fixture();
    f.submit.mockRestore();
    f.http.mockImplementationOnce(async (input, init) => {
      const request = new Request(input, init);
      expect({
        body: await request.json(),
        method: request.method,
        url: request.url,
      }).toStrictEqual({
        body: f.material.operation,
        method: "POST",
        url: `https://directory.test/${encodeURIComponent(f.material.did)}`,
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({ ok: true });
    });
    await f.directory.submitOperation(f.material.did, f.material.operation);
    expect(f.http).toHaveBeenCalledOnce();
  });

  it("requires an HTTPS origin and rejects key-edit fields", async () => {
    const f = await fixture();
    expect(
      patchPlcSchema.safeParse({
        expectedHead: f.genesis.cid,
        pdsEndpoint: "https://corrected.example.com",
      }).success
    ).toBeTruthy();
    for (const patch of [
      {},
      { pdsEndpoint: "http://pds.example.com" },
      { pdsEndpoint: "https://pds.example.com/" },
      { pdsEndpoint: "https://user:password@pds.example.com" },
      { pdsEndpoint: "https://pds.example.com/path" },
      { pdsEndpoint: "https://pds.example.com?query=1" },
      { pdsEndpoint: "https://pds.example.com#fragment" },
      { pdsEndpoint: "https://pds.example.com", rotationKeys: [f.managed] },
      {
        pdsEndpoint: "https://pds.example.com",
        personalRotationKey: f.managed,
      },
      {
        confirmManagedKeyRemoval: true,
        pdsEndpoint: "https://pds.example.com",
      },
    ]) {
      expect(
        patchPlcSchema.safeParse({ expectedHead: f.genesis.cid, ...patch })
          .success
      ).toBeFalsy();
    }
    const response = await f.request({
      expectedHead: f.genesis.cid,
      pdsEndpoint: "http://insecure.example.com",
    });
    expect(response.status).toBe(400);
    expect(f.submit).not.toHaveBeenCalled();
  });
});
