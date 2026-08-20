import {
  parsePrivateMultikey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import {
  defs,
  deriveDidFromGenesisOp,
  isSignedOperationValid,
} from "@atcute/did-plc";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import z from "zod";

const ORIGIN = "https://internal.test";

const request = (path: string, init?: RequestInit): Promise<Response> =>
  exports.default.fetch(new Request(`${ORIGIN}${path}`, init));

const registerResponseSchema = z.object({
  did: z.string(),
  operation: z.unknown(),
});

describe("admin register", () => {
  it("returns a signed PLC operation and reserves its repo", async () => {
    const controlPlaneKey = await Secp256k1PrivateKeyExportable.createKeypair();
    const controlPlaneDid = await controlPlaneKey.exportPublicKey("did");
    const parsedPdsKey = parsePrivateMultikey(env.PDS_ROTATION_KEY);
    if (parsedPdsKey.type !== "secp256k1") {
      throw new Error("Test rotation key must be secp256k1");
    }
    const pdsKey = await Secp256k1PrivateKey.importRaw(
      parsedPdsKey.privateKeyBytes
    );
    const pdsDid = await pdsKey.exportPublicKey("did");

    const response = await request("/admin/register", {
      body: JSON.stringify({
        name: "ab",
        rotationKeys: [pdsDid, controlPlaneDid],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(200);

    const payload = registerResponseSchema.parse(await response.json());
    const operationResult = await defs.operation["~standard"].validate(
      payload.operation
    );
    if (operationResult.issues) {
      throw new Error("Register returned an invalid PLC operation");
    }
    const operation = operationResult.value;

    expect(operation).toMatchObject({
      alsoKnownAs: ["at://ab.pds.test"],
      prev: null,
      rotationKeys: [controlPlaneDid, pdsDid],
      services: {
        atproto_pds: {
          endpoint: "https://pds.test",
          type: "AtprotoPersonalDataServer",
        },
      },
      type: "plc_operation",
      verificationMethods: { atproto: expect.stringMatching(/^did:key:/u) },
    });
    await expect(deriveDidFromGenesisOp(operation)).resolves.toBe(payload.did);
    await expect(
      isSignedOperationValid(operation.rotationKeys, operation)
    ).resolves.toBe(pdsDid);

    const pds = env.PDS.getByName(payload.did);
    const repoStatus = await pds.rpcGetRepoStatus();
    expect(repoStatus).toMatchObject({
      did: payload.did,
      head: expect.any(String),
      rev: expect.any(String),
    });
  });

  it("rejects invalid names and rotation keys", async () => {
    const invalidPayloadResponse = await request("/admin/register", {
      body: JSON.stringify({
        name: "Invalid.Name",
        rotationKeys: ["not-a-did-key"],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(invalidPayloadResponse.status).toBe(400);

    const rotationKey = await Secp256k1PrivateKeyExportable.createKeypair();
    const rotationKeyDid = await rotationKey.exportPublicKey("did");
    const shortNameResponse = await request("/admin/register", {
      body: JSON.stringify({ name: "a", rotationKeys: [rotationKeyDid] }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(shortNameResponse.status).toBe(400);
  });
});
