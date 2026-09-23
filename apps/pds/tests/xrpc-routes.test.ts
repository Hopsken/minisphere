import { env, exports, withEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "../src";

const ORIGIN = "https://internal.test";
const JSON_HEADERS = { "Content-Type": "application/json" };

interface JsonBody {
  [key: string]: JsonValue;
}
type JsonValue = boolean | JsonBody | JsonValue[] | null | number | string;

const request = (path: string, init?: RequestInit): Promise<Response> =>
  exports.default.fetch(new Request(`${ORIGIN}${path}`, init));

const post = (body: JsonBody): RequestInit => ({
  body: JSON.stringify(body),
  headers: JSON_HEADERS,
  method: "POST",
});

const unimplementedRoutes: [path: string, init?: RequestInit][] = [
  [
    "/xrpc/com.atproto.server.createSession",
    post({ identifier: "alice.test", password: "password" }),
  ],
  ["/xrpc/com.atproto.server.getSession"],
  ["/xrpc/com.atproto.server.describeServer"],
  [
    "/xrpc/com.atproto.repo.createRecord",
    post({
      collection: "app.bsky.feed.post",
      record: {},
      repo: "alice.test",
    }),
  ],
  [
    "/xrpc/com.atproto.repo.putRecord",
    post({
      collection: "app.bsky.feed.post",
      record: {},
      repo: "alice.test",
      rkey: "record",
    }),
  ],
  [
    "/xrpc/com.atproto.repo.deleteRecord",
    post({
      collection: "app.bsky.feed.post",
      repo: "alice.test",
      rkey: "record",
    }),
  ],
  [
    "/xrpc/com.atproto.repo.applyWrites",
    post({ repo: "alice.test", writes: [] }),
  ],
  ["/xrpc/com.atproto.sync.getRepo?did=did:plc:alice"],
  ["/xrpc/com.atproto.sync.getLatestCommit?did=did:plc:alice"],
  ["/xrpc/com.atproto.sync.subscribeRepos?cursor=1"],
];

const invalidRoutes: [path: string, init?: RequestInit][] = [
  ["/xrpc/com.atproto.server.createAccount", post({})],
  [
    "/xrpc/com.atproto.repo.createRecord",
    post({ collection: "not-an-nsid", record: {}, repo: "alice.test" }),
  ],
  ["/xrpc/com.atproto.repo.listRecords?repo=alice.test&limit=101"],
  ["/xrpc/com.atproto.sync.getRepo?did=not-a-did"],
  ["/xrpc/com.atproto.sync.subscribeRepos?cursor=1.5"],
  ["/xrpc/com.atproto.identity.resolveHandle?handle=not-a-handle"],
];

describe("XRPC route stubs", () => {
  it("checks configuration without database access", async () => {
    await withEnv(
      { ...env, PDS_DB: undefined, PLC_DIRECTORY: undefined },
      async () => {
        const response = await worker.fetch(
          new Request(`${ORIGIN}/health`),
          env
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        await expect(response.json()).resolves.toStrictEqual({ status: "ok" });
      }
    );
  });

  it.each(["/health", "/.well-known/oauth-protected-resource"])(
    "hides invalid configuration details on %s",
    async (path) => {
      await withEnv(
        { ...env, PLC_DIRECTORY: "https://private.invalid/secret-path" },
        async () => {
          const response = await worker.fetch(
            new Request(`${ORIGIN}${path}`),
            env
          );
          expect(response.status).toBe(500);
          await expect(response.text()).resolves.toBe("Internal Server Error");
        }
      );
    }
  );

  it("derives resource metadata without trusting the request host", async () => {
    await withEnv({ ...env, PDS_ORIGIN: undefined }, async () => {
      const response = await worker.fetch(
        new Request(`${ORIGIN}/.well-known/oauth-protected-resource`),
        env
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        authorization_servers: ["https://minisphere.test"],
        resource: "https://pds.minisphere.test",
      });
    });
  });

  it.each(unimplementedRoutes)("throws for %s", async (path, init) => {
    const response = await request(path, init);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe("Internal Server Error");
  });

  it.each(invalidRoutes)("validates input for %s", async (path, init) => {
    const response = await request(path, init);

    expect(response.status).toBe(400);
  });
});
