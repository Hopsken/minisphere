/* oxlint-disable unicorn/no-await-expression-member, vitest/max-expects, vitest/prefer-expect-resolves */

import { P256Keypair } from "@atproto/crypto";
import * as plc from "@did-plc/lib";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://directory.test";

const request = (path: string, init?: RequestInit): Promise<Response> =>
  exports.default.fetch(new Request(`${ORIGIN}${path}`, init));

const didPath = (did: string, suffix = ""): string =>
  `/${encodeURIComponent(did)}${suffix}`;

const sendOperation = (
  did: string,
  operation: plc.CompatibleOpOrTombstone
): Promise<Response> =>
  request(didPath(did), {
    body: JSON.stringify(operation),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

const createIdentity = async () => {
  const signingKey = await P256Keypair.create();
  const rotationKey1 = await P256Keypair.create();
  const rotationKey2 = await P256Keypair.create();
  const { did, op } = await plc.createOp({
    handle: "alice.example.com",
    pds: "example.com",
    rotationKeys: [rotationKey1.did(), rotationKey2.did()],
    signer: rotationKey1,
    signingKey: signingKey.did(),
  });

  const response = await sendOperation(did, op);
  expect(response.status).toBe(200);
  expect(await response.json()).toStrictEqual({ ok: true });

  return { did, op, rotationKey1, rotationKey2, signingKey };
};

const operationLog = async (
  did: string
): Promise<plc.CompatibleOpOrTombstone[]> => {
  const response = await request(didPath(did, "/log"));
  expect(response.status).toBe(200);
  return plc.def.compatibleOpOrTombstone.array().parse(await response.json());
};

describe("directory server", () => {
  it("registers and resolves a DID through every public read endpoint", async () => {
    const { did, op, rotationKey1, rotationKey2, signingKey } =
      await createIdentity();

    const dataResponse = await request(didPath(did, "/data"));
    expect(dataResponse.status).toBe(200);
    const data = plc.def.documentData.parse(await dataResponse.json());
    expect(data).toStrictEqual({
      alsoKnownAs: ["at://alice.example.com"],
      did,
      rotationKeys: [rotationKey1.did(), rotationKey2.did()],
      services: {
        atproto_pds: {
          endpoint: "https://example.com",
          type: "AtprotoPersonalDataServer",
        },
      },
      verificationMethods: { atproto: signingKey.did() },
    });

    const documentResponse = await request(didPath(did));
    expect(documentResponse.status).toBe(200);
    expect(documentResponse.headers.get("Content-Type")).toContain(
      "application/did+ld+json"
    );
    expect(await documentResponse.json()).toStrictEqual(plc.formatDidDoc(data));

    expect(await operationLog(did)).toStrictEqual([op]);

    const lastResponse = await request(didPath(did, "/log/last"));
    expect(lastResponse.status).toBe(200);
    expect(await lastResponse.json()).toStrictEqual(op);

    const auditResponse = await request(didPath(did, "/log/audit"));
    expect(auditResponse.status).toBe(200);
    expect(await auditResponse.json()).toStrictEqual([
      {
        cid: expect.any(String),
        createdAt: expect.any(String),
        did,
        nullified: false,
        operation: op,
      },
    ]);
  });

  it("applies authorized updates and rejects an invalid signer", async () => {
    const identity = await createIdentity();
    const nextSigningKey = await P256Keypair.create();
    const nextRotationKey = await P256Keypair.create();

    const signingUpdate = await plc.updateAtprotoKeyOp(
      identity.op,
      identity.rotationKey1,
      nextSigningKey.did()
    );
    expect((await sendOperation(identity.did, signingUpdate)).status).toBe(200);

    const rotationUpdate = await plc.updateRotationKeysOp(
      signingUpdate,
      identity.rotationKey1,
      [nextRotationKey.did(), identity.rotationKey2.did()]
    );
    expect((await sendOperation(identity.did, rotationUpdate)).status).toBe(
      200
    );

    const handleUpdate = await plc.updateHandleOp(
      rotationUpdate,
      nextRotationKey,
      "alice.example.net"
    );
    expect((await sendOperation(identity.did, handleUpdate)).status).toBe(200);

    const pdsUpdate = await plc.updatePdsOp(
      handleUpdate,
      nextRotationKey,
      "pds.example.net"
    );
    expect((await sendOperation(identity.did, pdsUpdate)).status).toBe(200);

    const dataResponse = await request(didPath(identity.did, "/data"));
    expect(await dataResponse.json()).toStrictEqual({
      alsoKnownAs: ["at://alice.example.net"],
      did: identity.did,
      rotationKeys: [nextRotationKey.did(), identity.rotationKey2.did()],
      services: {
        atproto_pds: {
          endpoint: "https://pds.example.net",
          type: "AtprotoPersonalDataServer",
        },
      },
      verificationMethods: { atproto: nextSigningKey.did() },
    });

    const attacker = await P256Keypair.create();
    const unauthorized = await plc.updateAtprotoKeyOp(
      pdsUpdate,
      attacker,
      attacker.did()
    );
    expect((await sendOperation(identity.did, unauthorized)).status).toBe(400);

    const log = await operationLog(identity.did);
    expect(log).toStrictEqual([
      identity.op,
      signingUpdate,
      rotationUpdate,
      handleUpdate,
      pdsUpdate,
    ]);
    await expect(
      plc.validateOperationLog(identity.did, log)
    ).resolves.toStrictEqual(
      expect.objectContaining({
        did: identity.did,
        verificationMethods: { atproto: nextSigningKey.did() },
      })
    );
  });

  it("enforces rotation and verification-method key support", async () => {
    const identity = await createIdentity();
    const ed25519Key =
      "did:key:z6MkjwbBXZnFqL8su24wGL2Fdjti6GSLv9SWdYGswfazUPm9";

    const unsupportedRotation = await plc.updateRotationKeysOp(
      identity.op,
      identity.rotationKey1,
      [identity.rotationKey2.did(), ed25519Key]
    );
    expect(
      (await sendOperation(identity.did, unsupportedRotation)).status
    ).toBe(400);

    const invalidResponses = await Promise.all(
      [
        "did:key:BJV2WY5DJMJQXGZJANFZSAYLXMVZW63LFEEQFY3ZP",
        "did:banana",
        "blah",
      ].map(async (invalidKey) => {
        const invalidVerificationMethod = await plc.updateAtprotoKeyOp(
          identity.op,
          identity.rotationKey1,
          invalidKey
        );
        return sendOperation(identity.did, invalidVerificationMethod);
      })
    );
    expect(invalidResponses.map(({ status }) => status)).toStrictEqual([
      400, 400, 400,
    ]);

    const futureKey =
      "did:key:zUC7K4ndUaGZgV7Cp2yJy6JtMoUHY6u7tkcSYUvPrEidqBmLCTLmi6d5WvwnUqejscAkERJ3bfjEiSYtdPkRSE8kSa11hFBr4sTgnbZ95SJj19PN2jdvJjyzpSZgxkyyxNnBNnY";
    const futureKeyUpdate = await plc.updateAtprotoKeyOp(
      identity.op,
      identity.rotationKey1,
      futureKey
    );
    expect((await sendOperation(identity.did, futureKeyUpdate)).status).toBe(
      400
    );
  });

  it("rejects legacy creates and unknown operation fields without storing them", async () => {
    const signingKey = await P256Keypair.create();
    const rotationKey = await P256Keypair.create();
    const { did, op } = await plc.createOp({
      handle: "strict.example.com",
      pds: "strict.example.com",
      rotationKeys: [rotationKey.did()],
      signer: rotationKey,
      signingKey: signingKey.did(),
    });

    const operationWithUnexpectedField = { ...op, unexpected: true };
    expect(
      (await sendOperation(did, operationWithUnexpectedField)).status
    ).toBe(400);

    const operationWithPaddedSignature = { ...op, sig: `${op.sig}=` };
    const paddedSignatureDid = await plc.didForCreateOp(
      operationWithPaddedSignature
    );
    expect(
      (await sendOperation(paddedSignatureDid, operationWithPaddedSignature))
        .status
    ).toBe(400);

    const operationWithExtraServiceField = await plc.addSignature(
      {
        alsoKnownAs: [],
        prev: null,
        rotationKeys: [rotationKey.did()],
        services: {
          custom: {
            endpoint: "https://example.com",
            extraField: "not allowed",
            type: "ExampleService",
          },
        },
        type: "plc_operation" as const,
        verificationMethods: {},
      },
      rotationKey
    );
    const malformedDid = await plc.didForCreateOp(
      operationWithExtraServiceField
    );
    expect(
      (await sendOperation(malformedDid, operationWithExtraServiceField)).status
    ).toBe(400);

    const legacyCreate = await plc.deprecatedSignCreate(
      {
        handle: "at://legacy.example.com",
        prev: null,
        recoveryKey: rotationKey.did(),
        service: "https://legacy.example.com",
        signingKey: signingKey.did(),
        type: "create",
      },
      signingKey
    );
    const legacyDid = await plc.didForCreateOp(legacyCreate);
    expect((await sendOperation(legacyDid, legacyCreate)).status).toBe(400);

    expect((await request(didPath(did, "/log"))).status).toBe(404);
    expect((await request(didPath(paddedSignatureDid, "/log"))).status).toBe(
      404
    );
    expect((await request(didPath(malformedDid, "/log"))).status).toBe(404);
    expect((await request(didPath(legacyDid, "/log"))).status).toBe(404);
  });

  it("recovers from a fork and exposes the nullified branch in the audit log", async () => {
    const identity = await createIdentity();
    const attackerKey = await P256Keypair.create();
    const compromisedUpdate = await plc.updateRotationKeysOp(
      identity.op,
      identity.rotationKey2,
      [attackerKey.did()]
    );
    expect((await sendOperation(identity.did, compromisedUpdate)).status).toBe(
      200
    );

    const recoveredKey = await P256Keypair.create();
    const recoveryUpdate = await plc.updateRotationKeysOp(
      identity.op,
      identity.rotationKey1,
      [identity.rotationKey1.did(), recoveredKey.did()]
    );
    expect((await sendOperation(identity.did, recoveryUpdate)).status).toBe(
      200
    );

    const log = await operationLog(identity.did);
    expect(log).toStrictEqual([identity.op, recoveryUpdate]);
    await expect(
      plc.validateOperationLog(identity.did, log)
    ).resolves.toStrictEqual(
      expect.objectContaining({
        rotationKeys: [identity.rotationKey1.did(), recoveredKey.did()],
      })
    );

    const auditResponse = await request(didPath(identity.did, "/log/audit"));
    expect(auditResponse.status).toBe(200);
    const audit = await auditResponse.json();
    expect(audit).toStrictEqual([
      expect.objectContaining({ nullified: false, operation: identity.op }),
      expect.objectContaining({
        nullified: true,
        operation: compromisedUpdate,
      }),
      expect.objectContaining({ nullified: false, operation: recoveryUpdate }),
    ]);
  });

  it("serializes racing updates into one coherent canonical history", async () => {
    const identity = await createIdentity();
    const nextKeys = await Promise.all(
      Array.from({ length: 10 }, () => P256Keypair.create())
    );
    const updates = await Promise.all(
      nextKeys.map((key) =>
        plc.updateAtprotoKeyOp(identity.op, identity.rotationKey1, key.did())
      )
    );

    const responses = await Promise.all(
      updates.map((operation) => sendOperation(identity.did, operation))
    );
    expect(responses.filter(({ ok }) => ok)).toHaveLength(1);
    expect(responses.filter(({ ok }) => !ok)).toHaveLength(9);

    const log = await operationLog(identity.did);
    expect(log).toHaveLength(2);
    await expect(
      plc.validateOperationLog(identity.did, log)
    ).resolves.not.toBeNull();
  });

  it("tombstones a DID while retaining its verifiable operation log", async () => {
    const identity = await createIdentity();
    const { cid } = await plc.getLastOpWithCid([identity.op]);
    const tombstone = await plc.tombstoneOp(cid, identity.rotationKey1);
    expect((await sendOperation(identity.did, tombstone)).status).toBe(200);

    expect((await request(didPath(identity.did))).status).toBe(404);
    expect((await request(didPath(identity.did, "/data"))).status).toBe(404);

    const log = await operationLog(identity.did);
    expect(log).toStrictEqual([identity.op, tombstone]);
    await expect(
      plc.validateOperationLog(identity.did, log)
    ).resolves.toBeNull();
  });
});
