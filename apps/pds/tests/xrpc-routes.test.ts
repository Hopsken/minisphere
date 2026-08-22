import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://internal.test";
const JSON_HEADERS = { "Content-Type": "application/json" };

const request = (path: string, init?: RequestInit): Promise<Response> =>
  exports.default.fetch(new Request(`${ORIGIN}${path}`, init));

const post = (body: unknown): RequestInit => ({
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
  [
    "/xrpc/com.atproto.repo.getRecord?repo=alice.test&collection=app.bsky.feed.post&rkey=record",
  ],
  [
    "/xrpc/com.atproto.repo.listRecords?repo=alice.test&collection=app.bsky.feed.post&limit=10&reverse=true",
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
