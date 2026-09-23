/* oxlint-disable vitest/max-expects, eslint/no-await-in-loop -- Ordered integration flows verify responses, persisted records, and unchanged heads at each boundary. */
import * as CreateRecord from "@atcute/atproto/types/repo/createRecord";
import { fromUint8Array } from "@atcute/car";
import {
  parsePrivateMultikey,
  Secp256k1PrivateKey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import type { Did } from "@atcute/lexicons/syntax";
import { parse } from "@atcute/lexicons/validations";
import { verifyRecords } from "@atproto/repo";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import {
  base64url,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { assert, describe, expect, it } from "vitest";

import worker from "../src";
import { createPdsDatabase } from "../src/db";
import { accountsTable } from "../src/db/schema";
import { DpopStateRepository } from "../src/repositories/dpop-state";

const ORIGIN = "https://pds.test";
const ISSUER = "https://minisphere.test";
const COLLECTION = "app.example.item";
const record = (text: string) => ({ $type: COLLECTION, text });

interface WriteBody {
  [key: string]: JsonValue | undefined;
}
type JsonValue =
  | string
  | number
  | boolean
  | null
  | WriteBody
  | (JsonValue | undefined)[];
interface ProofOverrides {
  htm?: string;
  htu?: string;
  ath?: string;
  iat?: number;
  jti?: string;
  nonce?: string | undefined;
}

const setup = async (scope = `atproto repo:${COLLECTION}`, register = true) => {
  const suffix = Array.from(
    crypto.getRandomValues(new Uint8Array(24)),
    (byte) => "abcdefghijklmnopqrstuvwxyz234567"[byte % 32]
  ).join("");
  const did: Did<"plc"> = `did:plc:${suffix}`;
  const repoKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const stub = env.REPO.getByName(did);
  await stub.reserveRepo(did, await repoKey.exportPrivateKey("multikey"));
  const db = createPdsDatabase(env.PDS_DB);
  if (register) {
    await db.insert(accountsTable).values({ did });
  }

  const signingKey = parsePrivateMultikey(env.TEST_ACCOUNTS_OAUTH_SIGNING_KEY);
  const oauthKey = await Secp256k1PrivateKey.importRaw(
    signingKey.privateKeyBytes
  );
  const kid = await oauthKey.exportPublicKey("did");
  const proofKey = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(proofKey.publicKey);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url.encode(
    JSON.stringify({ alg: "ES256K", kid, typ: "at+jwt" })
  );
  const payload = base64url.encode(
    JSON.stringify({
      aud: ORIGIN,
      client_id: "https://town.test/metadata.json",
      cnf: { jkt: await calculateJwkThumbprint(jwk) },
      exp: now + 300,
      iat: now,
      iss: ISSUER,
      jti: crypto.randomUUID(),
      scope,
      sub: did,
    })
  );
  const signingInput = `${header}.${payload}`;
  const token = `${signingInput}.${base64url.encode(await oauthKey.sign(new TextEncoder().encode(signingInput)))}`;
  const state = new DpopStateRepository(db);
  const nonce = await state.createNonce();
  const proof = async (method: string, overrides: ProofOverrides = {}) =>
    new SignJWT({
      ath: base64url.encode(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
        )
      ),
      htm: "POST",
      htu: `${ORIGIN}/xrpc/com.atproto.repo.${method}`,
      nonce,
      ...overrides,
    })
      .setProtectedHeader({ alg: "ES256", jwk, typ: "dpop+jwt" })
      .setIssuedAt(overrides.iat ?? now)
      .setJti(overrides.jti ?? crypto.randomUUID())
      .sign(proofKey.privateKey);
  const send = (
    method: string,
    body: WriteBody,
    dpop: string,
    authorization = `DPoP ${token}`
  ) =>
    worker.fetch(
      new Request(`${ORIGIN}/xrpc/com.atproto.repo.${method}`, {
        body: JSON.stringify({ repo: did, ...body }),
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          DPoP: dpop,
          Origin: "https://town.test",
        },
        method: "POST",
      }),
      env
    );
  const write = async (method: string, body: WriteBody) =>
    send(method, body, await proof(method));
  const create = async (rkey: string, text = rkey) => {
    const response = await write("createRecord", {
      collection: COLLECTION,
      record: record(text),
      rkey,
    });
    expect(response.status).toBe(200);
    return parse(CreateRecord.mainSchema.output.schema, await response.json());
  };
  return {
    create,
    did,
    proof,
    publicKey: await repoKey.exportPublicKey("did"),
    send,
    state,
    stub,
    token,
    write,
  };
};

describe("authenticated repository writes", () => {
  it("creates, replaces with CAS, deletes, and reads signed records after eviction", async () => {
    const { did, stub, create, write, publicKey } = await setup();
    const first = await create("one", "before");
    expect(first.uri).toBe(`at://${did}/${COLLECTION}/one`);
    expect(first.validationStatus).toBe("unknown");
    const response = await write("putRecord", {
      collection: COLLECTION,
      record: record("after"),
      rkey: "one",
      swapCommit: first.commit?.cid,
      swapRecord: first.cid,
    });
    expect(response.status).toBe(200);
    const updated = parse(
      CreateRecord.mainSchema.output.schema,
      await response.json()
    );
    expect(updated.cid).not.toBe(first.cid);
    await evictDurableObject(stub);
    await expect(stub.rpcGetRecord(COLLECTION, "one")).resolves.toStrictEqual({
      cid: updated.cid,
      record: record("after"),
    });
    const proof = await stub.rpcGetRecordProof(COLLECTION, "one");
    const car = new Uint8Array(await new Response(proof).arrayBuffer());
    expect(fromUint8Array(car).roots).toHaveLength(1);
    const verified = await verifyRecords(car, did, publicKey);
    expect(verified).toStrictEqual([
      { collection: COLLECTION, record: record("after"), rkey: "one" },
    ]);
    const deleted = await write("deleteRecord", {
      collection: COLLECTION,
      rkey: "one",
      swapRecord: updated.cid,
    });
    expect(deleted.status).toBe(200);
    const head = await stub.rpcGetRepoStatus();
    await expect(
      write("deleteRecord", { collection: COLLECTION, rkey: "one" })
    ).resolves.toMatchObject({ status: 200 });
    await expect(stub.rpcGetRepoStatus()).resolves.toStrictEqual(head);
    await expect(stub.rpcGetRecord(COLLECTION, "one")).resolves.toBeNull();
  });

  it("distinguishes null, absent and stale swap conditions without changing the head", async () => {
    const { stub, create, write } = await setup();
    const first = await create("one");
    const second = await create("two");
    const head = await stub.rpcGetRepoStatus();
    for (const condition of [
      { swapRecord: null },
      { swapRecord: second.cid },
      { swapCommit: first.commit?.cid },
    ]) {
      const response = await write("putRecord", {
        collection: COLLECTION,
        record: record("new"),
        rkey: "one",
        ...condition,
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: "InvalidSwap",
      });
      await expect(stub.rpcGetRepoStatus()).resolves.toStrictEqual(head);
    }
    await expect(
      write("putRecord", {
        collection: COLLECTION,
        record: record("new"),
        rkey: "three",
        swapRecord: null,
      })
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      write("putRecord", {
        collection: COLLECTION,
        record: record("new"),
        rkey: "one",
      })
    ).resolves.toMatchObject({ status: 200 });
    const current = await stub.rpcGetRepoStatus();
    await expect(
      write("putRecord", {
        collection: COLLECTION,
        record: record("new"),
        rkey: "one",
      })
    ).resolves.toMatchObject({ status: 200 });
    await expect(stub.rpcGetRepoStatus()).resolves.toStrictEqual(current);
  });

  it("serializes concurrent writes and permits only one contender for a head", async () => {
    const { stub, create, write } = await setup();
    await Promise.all(
      Array.from({ length: 12 }, (_, index) => create(`item-${index}`))
    );
    const page = await stub.rpcListRecords({
      collection: COLLECTION,
      cursor: undefined,
      limit: 100,
      reverse: true,
    });
    expect(page.records).toHaveLength(12);
    const head = await stub.rpcGetRepoStatus();
    const responses = await Promise.all(
      ["a", "b"].map((rkey) =>
        write("createRecord", {
          collection: COLLECTION,
          record: record(rkey),
          rkey,
          swapCommit: head.head,
        })
      )
    );
    expect(responses.map((r) => r.status).toSorted()).toStrictEqual([200, 400]);
  });

  it("commits 200 records atomically, handles ordered operations, and rejects oversized batches", async () => {
    const { stub, write } = await setup();
    const writes = Array.from({ length: 200 }, (_, index) => ({
      $type: "com.atproto.repo.applyWrites#create",
      collection: COLLECTION,
      rkey: `item-${index}`,
      value: record(`value-${index}`),
    }));
    const response = await write("applyWrites", { writes });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: expect.any(Array),
    });
    await evictDurableObject(stub);
    for (const index of [0, 89, 199]) {
      await expect(
        stub.rpcGetRecord(COLLECTION, `item-${index}`)
      ).resolves.toMatchObject({ record: record(`value-${index}`) });
    }
    const head = await stub.rpcGetRepoStatus();
    const failed = await write("applyWrites", {
      writes: [{ ...writes[0], rkey: "new" }, writes[0]],
    });
    expect(failed.status).toBe(400);
    await expect(stub.rpcGetRecord(COLLECTION, "new")).resolves.toBeNull();
    await expect(stub.rpcGetRepoStatus()).resolves.toStrictEqual(head);
    await expect(
      write("applyWrites", { writes: [...writes, writes[0]] })
    ).resolves.toMatchObject({ status: 400 });
    const ordered = await write("applyWrites", {
      writes: [
        {
          $type: "com.atproto.repo.applyWrites#create",
          collection: COLLECTION,
          rkey: "sequence",
          value: record("initial"),
        },
        {
          $type: "com.atproto.repo.applyWrites#update",
          collection: COLLECTION,
          rkey: "sequence",
          value: record("final"),
        },
        {
          $type: "com.atproto.repo.applyWrites#delete",
          collection: COLLECTION,
          rkey: "item-199",
        },
      ],
    });
    expect(ordered.status).toBe(200);
    await expect(
      stub.rpcGetRecord(COLLECTION, "sequence")
    ).resolves.toMatchObject({ record: record("final") });
    await expect(stub.rpcGetRecord(COLLECTION, "item-199")).resolves.toBeNull();
  });

  it("rolls back blocks when storage fails after insertion and recovers the write queue", async () => {
    const { stub, write, create } = await setup();
    const head = await stub.rpcGetRepoStatus();
    const before = await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER fail_root BEFORE UPDATE ON metadata BEGIN SELECT RAISE(ABORT, 'test failure'); END"
      );
      return state.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM blocks")
        .one().count;
    });
    await expect(
      write("createRecord", {
        collection: COLLECTION,
        record: record("failed"),
        rkey: "failed",
      })
    ).resolves.toMatchObject({ status: 500 });
    await expect(stub.rpcGetRepoStatus()).resolves.toStrictEqual(head);
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM blocks")
          .one().count
      ).toBe(before);
      state.storage.sql.exec("DROP TRIGGER fail_root");
    });
    await create("recovered");
    await expect(stub.rpcGetRecord(COLLECTION, "failed")).resolves.toBeNull();
  });

  it("requires per-operation scopes and never grants cross-account access", async () => {
    const { stub, did, write } = await setup(
      `atproto repo:${COLLECTION}?action=create`
    );
    const head = await stub.rpcGetRepoStatus();
    for (const method of ["putRecord", "deleteRecord"]) {
      await expect(
        write(method, {
          collection: COLLECTION,
          record: record("one"),
          rkey: "one",
        })
      ).resolves.toMatchObject({ status: 403 });
    }
    await expect(
      write("createRecord", {
        collection: COLLECTION,
        record: record("one"),
        repo: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
        rkey: "one",
      })
    ).resolves.toMatchObject({ status: 403 });
    await expect(
      write("applyWrites", {
        repo: did,
        writes: [
          {
            $type: "com.atproto.repo.applyWrites#create",
            collection: COLLECTION,
            rkey: "one",
            value: record("one"),
          },
          {
            $type: "com.atproto.repo.applyWrites#delete",
            collection: COLLECTION,
            rkey: "two",
          },
        ],
      })
    ).resolves.toMatchObject({ status: 403 });
    await expect(stub.rpcGetRepoStatus()).resolves.toStrictEqual(head);
  });

  it("accepts official posts, generates a TID and rejects invalid post schema", async () => {
    const { write, stub } = await setup(
      "atproto repo?collection=app.bsky.feed.post&action=create"
    );
    const post = {
      $type: "app.bsky.feed.post",
      createdAt: new Date().toISOString(),
      text: "你好 👨‍👩‍👧‍👦",
    };
    const response = await write("createRecord", {
      collection: "app.bsky.feed.post",
      record: post,
    });
    expect(response.status).toBe(200);
    const created = parse(
      CreateRecord.mainSchema.output.schema,
      await response.json()
    );
    expect(created.validationStatus).toBe("valid");
    expect(created.uri.split("/").at(-1)).toMatch(/^[234567a-z]{13}$/u);
    const head = await stub.rpcGetRepoStatus();
    for (const bad of [
      { ...post, text: "a".repeat(301) },
      { ...post, createdAt: "today" },
      { ...post, $type: COLLECTION },
    ]) {
      await expect(
        write("createRecord", { collection: "app.bsky.feed.post", record: bad })
      ).resolves.toMatchObject({ status: 400 });
    }
    await expect(stub.rpcGetRepoStatus()).resolves.toStrictEqual(head);
  });

  it("honors validate tri-state and rejects malformed Lexicon values and blobs", async () => {
    const { write } = await setup();
    await expect(
      write("createRecord", {
        collection: COLLECTION,
        record: record("unknown"),
        validate: true,
      })
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      write("createRecord", {
        collection: COLLECTION,
        record: record("unknown"),
        validate: false,
      })
    ).resolves.toMatchObject({ status: 200 });
    for (const value of [
      { n: 1.5 },
      { link: { $link: "invalid" } },
      { nested: [{ $type: "blob" }] },
    ]) {
      await expect(
        write("createRecord", {
          collection: COLLECTION,
          record: value,
          validate: false,
        })
      ).resolves.toMatchObject({ status: 400 });
    }
  });

  it("challenges missing nonce with browser-visible headers and accepts a new proof", async () => {
    const { send, proof } = await setup();
    const body = { collection: COLLECTION, record: record("nonce") };
    const response = await send(
      "createRecord",
      body,
      await proof("createRecord", { nonce: undefined })
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "use_dpop_nonce",
    });
    const nonce = response.headers.get("DPoP-Nonce");
    assert(nonce !== null);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "use_dpop_nonce"
    );
    expect(response.headers.get("Access-Control-Expose-Headers")).toContain(
      "DPoP-Nonce"
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(
      send("createRecord", body, await proof("createRecord", { nonce }))
    ).resolves.toMatchObject({ status: 200 });
  });

  it("rejects wrong proof bindings, stale proofs and concurrent replays", async () => {
    const { proof, send, stub } = await setup();
    const body = { collection: COLLECTION, record: record("proof") };
    const head = await stub.rpcGetRepoStatus();
    for (const override of [
      { htm: "GET" },
      { htu: `${ORIGIN}/wrong` },
      { ath: "wrong" },
      { iat: Math.floor(Date.now() / 1000) - 120 },
    ]) {
      await expect(
        send("createRecord", body, await proof("createRecord", override))
      ).resolves.toMatchObject({ status: 401 });
    }
    await expect(stub.rpcGetRepoStatus()).resolves.toStrictEqual(head);
    const dpop = await proof("createRecord");
    const responses = await Promise.all([
      send("createRecord", body, dpop),
      send("createRecord", body, dpop),
    ]);
    expect(responses.map((r) => r.status).toSorted()).toStrictEqual([200, 401]);
  });

  it.each(["atproto", "atproto repo:app.other.item"])(
    "does not authorize writes with %s",
    async (scope) => {
      const { write } = await setup(scope);
      await expect(
        write("createRecord", {
          collection: COLLECTION,
          record: record("denied"),
        })
      ).resolves.toMatchObject({ status: 403 });
    }
  );

  it("rejects unregistered token subjects", async () => {
    const { write } = await setup(`atproto repo:${COLLECTION}`, false);
    await expect(
      write("createRecord", {
        collection: COLLECTION,
        record: record("denied"),
      })
    ).resolves.toMatchObject({ status: 401 });
  });
});
