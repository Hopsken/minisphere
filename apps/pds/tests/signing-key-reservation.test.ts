import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createPdsDatabase } from "../src/db";
import { SigningKeyReservationRepository } from "../src/repositories/signing-key-reservation";

const createRepository = () =>
  new SigningKeyReservationRepository(
    createPdsDatabase(env.PDS_DB),
    env.PDS_SIGNING_KEY_ENCRYPTION_KEY
  );

type RepoTestInstance = DurableObject & {
  reserveRepo: (did: string, signingKey: string) => Promise<void>;
  rpcGetRepoStatus: () => Promise<{ did: string; head: string; rev: string }>;
};

describe("signing-key reservations", () => {
  it("stores encrypted private keys without expiring reservations", async () => {
    const repository = createRepository();
    const signingKey = await repository.reserve();
    const privateKey = await repository.get(
      "did:plc:encryptiontest000000000",
      signingKey
    );
    const reservation = await env.PDS_DB.prepare(
      `SELECT created_at, encrypted_private_key, encryption_iv
       FROM signing_key_reservations
       WHERE signing_key = ?`
    )
      .bind(signingKey)
      .first<{
        created_at: number;
        encrypted_private_key: string;
        encryption_iv: string;
      }>();

    expect(privateKey).toStrictEqual(expect.any(String));
    expect(reservation).toMatchObject({
      created_at: expect.any(Number),
      encrypted_private_key: expect.any(String),
      encryption_iv: expect.any(String),
    });
    expect(reservation?.encrypted_private_key).not.toBe(privateKey);
    expect(reservation?.encrypted_private_key).not.toContain(privateKey ?? "");

    await env.PDS_DB.prepare(
      "UPDATE signing_key_reservations SET created_at = 0 WHERE signing_key = ?"
    )
      .bind(signingKey)
      .run();
    await expect(
      repository.get("did:plc:encryptiontest000000000", signingKey)
    ).resolves.toBe(privateKey);
  });

  it("returns one reservation for concurrent requests for the same DID", async () => {
    const repository = createRepository();
    const did = "did:plc:concurrentreservation00";
    const signingKeys = await Promise.all(
      Array.from({ length: 8 }, () => repository.reserve(did))
    );
    const reservationCount = await env.PDS_DB.prepare(
      "SELECT count(*) AS count FROM signing_key_reservations WHERE did = ?"
    )
      .bind(did)
      .first<{ count: number }>();

    expect(new Set(signingKeys)).toHaveLength(1);
    expect(reservationCount?.count).toBe(1);
  });

  it("allows one concurrent claimant and permits its idempotent retry", async () => {
    const repository = createRepository();
    const signingKey = await repository.reserve();
    const dids = [
      "did:plc:reservationclaimtest00",
      "did:plc:anotherclaimant000000",
    ] as const;
    const claims = await Promise.all(
      dids.map((did) => repository.claim(did, signingKey))
    );
    const privateKey = claims[0] ?? claims[1];
    const winnerDid = claims[0] ? dids[0] : dids[1];
    const loserDid = claims[0] ? dids[1] : dids[0];

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    expect(privateKey).toStrictEqual(expect.any(String));
    await expect(repository.claim(winnerDid, signingKey)).resolves.toBe(
      privateKey
    );
    await expect(repository.claim(loserDid, signingKey)).resolves.toBeNull();
  });
});

describe("RepoDO reservation", () => {
  it("retries with the same key and rejects a different signing key", async () => {
    const did = "did:plc:repokeyreservationtest0";
    const [signingKey, differentKey] = await Promise.all([
      Secp256k1PrivateKeyExportable.createKeypair(),
      Secp256k1PrivateKeyExportable.createKeypair(),
    ]);
    const [privateSigningKey, differentPrivateKey] = await Promise.all([
      signingKey.exportPrivateKey("multikey"),
      differentKey.exportPrivateKey("multikey"),
    ]);
    const repo = env.REPO.getByName(did);

    await repo.reserveRepo(did, privateSigningKey);
    await expect(
      repo.reserveRepo(did, privateSigningKey)
    ).resolves.toBeUndefined();
    await expect(repo.rpcGetRepoStatus()).resolves.toMatchObject({ did });
    // SAFETY: REPO is configured as the exported RepoDO class in wrangler.jsonc.
    await runInDurableObject(repo as DurableObjectStub, async (instance) => {
      // SAFETY: runInDurableObject returns the RepoDO instance for this stub.
      const repoInstance = instance as RepoTestInstance;
      await expect(
        repoInstance.reserveRepo(did, differentPrivateKey)
      ).rejects.toThrow("Repository uses a different signing key");
    });
  });

  it("replaces an incomplete legacy initialization atomically", async () => {
    const did = "did:plc:incompleterepotest0000";
    const signingKey = await Secp256k1PrivateKeyExportable.createKeypair();
    const privateSigningKey = await signingKey.exportPrivateKey("multikey");
    const repo = env.REPO.getByName(did);

    await runInDurableObject(
      // SAFETY: REPO is configured as the exported RepoDO class in wrangler.jsonc.
      repo as DurableObjectStub,
      async (instance, state) => {
        state.storage.sql.exec(
          "INSERT INTO metadata (id, did, rev, root_cid) VALUES (1, ?, '', '')",
          did
        );
        state.storage.kv.put("signingKey", privateSigningKey);

        // SAFETY: runInDurableObject returns the RepoDO instance for this stub.
        const repoInstance = instance as RepoTestInstance;
        await repoInstance.reserveRepo(did, privateSigningKey);
        await expect(repoInstance.rpcGetRepoStatus()).resolves.toMatchObject({
          did,
          head: expect.any(String),
          rev: expect.any(String),
        });

        const [metadata] = state.storage.sql.exec<{
          blocks: number;
          rev: string;
          root_cid: string;
        }>(`SELECT
               (SELECT count(*) FROM blocks) AS blocks,
               rev,
               root_cid
             FROM metadata`);
        expect(metadata).toMatchObject({
          blocks: expect.any(Number),
          rev: expect.not.stringMatching(/^$/u),
          root_cid: expect.not.stringMatching(/^$/u),
        });
        expect(metadata?.blocks).toBeGreaterThan(0);
      }
    );
  });
});
