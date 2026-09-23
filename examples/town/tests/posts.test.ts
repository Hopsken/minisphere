import { Client } from "@atcute/client";
import type { FetchHandler } from "@atcute/client";
import { ValidationError } from "@atcute/lexicons";
import { describe, expect, it, vi } from "vitest";

import {
  canCreatePost,
  countGraphemes,
  createPost,
  getRecentPosts,
  PostPublisher,
} from "../src/lib/posts";

const did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};
const missing = () =>
  Response.json({ error: "RecordNotFound" }, { status: 400 });
const readResult = (record: ReturnType<typeof createPost> | undefined) =>
  Response.json({
    cid: "test",
    uri: `at://${did}/app.bsky.feed.post/3m4aaaaaaaaaa2`,
    value: record,
  });

describe("post validation", () => {
  it("counts graphemes rather than UTF-16 units or code points", () => {
    expect(countGraphemes("a👩🏽‍💻e\u0301🇨🇳")).toBe(4);
    expect(createPost("e\u0301".repeat(300)).text).toBe("e\u0301".repeat(300));
    expect(() => createPost("a".repeat(301))).toThrow(ValidationError);
  });

  it("enforces the official byte limit even below 300 graphemes", () => {
    const text = "👨‍👩‍👧‍👦".repeat(121);
    expect(countGraphemes(text)).toBe(121);
    expect(() => createPost(text)).toThrow(ValidationError);
    expect(() => createPost(" \n\t　")).toThrow("Write something");
  });

  it("requires create permission for this collection", () => {
    expect(canCreatePost("atproto")).toBeFalsy();
    expect(
      canCreatePost("atproto repo?collection=app.bsky.feed.post&action=delete")
    ).toBeFalsy();
    expect(
      canCreatePost("atproto repo?collection=app.bsky.feed.like&action=create")
    ).toBeFalsy();
    expect(
      canCreatePost("atproto repo?collection=app.bsky.feed.post&action=create")
    ).toBeTruthy();
    expect(
      canCreatePost("atproto repo:app.bsky.feed.post?action=create")
    ).toBeTruthy();
  });
});

describe("post publishing", () => {
  it("writes once and reads the actual record before reporting success", async () => {
    let written: ReturnType<typeof createPost> | undefined;
    const write = vi.fn<FetchHandler>((_path, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        collection: "app.bsky.feed.post",
        repo: did,
        validate: true,
      });
      expect(body.rkey).toMatch(/^[234567a-z]{13}$/u);
      written = body.record;
      return Promise.resolve(Response.json({ cid: "test", uri: "at://post" }));
    });
    const read = vi.fn<FetchHandler>(() =>
      Promise.resolve(readResult(written))
    );
    const publisher = new PostPublisher(
      new Client({ handler: write }),
      new Client({ handler: read }),
      did,
      storage()
    );
    const post = await publisher.publish("Hello 👋");
    expect(post.record.text).toBe("Hello 👋");
    expect(publisher.pending).toBeNull();
    expect(write).toHaveBeenCalledOnce();
  });

  it("never repeats a confirmed write after readback fails, including reload", async () => {
    const store = storage();
    const write = vi.fn<FetchHandler>(() =>
      Promise.resolve(Response.json({ cid: "test", uri: "at://post" }))
    );
    const read = vi.fn<FetchHandler>(() =>
      Promise.resolve(Response.json({ error: "Unavailable" }, { status: 503 }))
    );
    const writer = new Client({ handler: write });
    const reader = new Client({ handler: read });
    const first = new PostPublisher(writer, reader, did, store);
    await expect(first.publish("Keep me")).rejects.toThrow("Posted");
    expect(first.pending?.confirmed).toBeTruthy();
    const reloaded = new PostPublisher(writer, reader, did, store);
    await expect(reloaded.publish("Do not send this")).rejects.toThrow(
      "Posted"
    );
    read.mockResolvedValue(readResult(first.pending?.record));
    await expect(reloaded.check()).resolves.toMatchObject({
      record: { text: "Keep me" },
    });
    expect(write).toHaveBeenCalledOnce();
  });

  it("recovers a timed-out successful write without a second create", async () => {
    let written: ReturnType<typeof createPost> | undefined;
    const write = vi.fn<FetchHandler>((_path, init) => {
      written = JSON.parse(String(init?.body)).record;
      return Promise.reject(new Error("Network timeout"));
    });
    const publisher = new PostPublisher(
      new Client({ handler: write }),
      new Client({ handler: () => Promise.resolve(readResult(written)) }),
      did,
      storage()
    );
    await expect(publisher.publish("Recovered")).resolves.toMatchObject({
      record: { text: "Recovered" },
    });
    expect(write).toHaveBeenCalledOnce();
  });

  it("retains the draft and reuses its key only after a not-found check", async () => {
    const store = storage();
    const write = vi.fn<FetchHandler>(() =>
      Promise.reject(new Error("Offline"))
    );
    const read = vi.fn<FetchHandler>(() => Promise.resolve(missing()));
    const writer = new Client({ handler: write });
    const reader = new Client({ handler: read });
    const first = new PostPublisher(writer, reader, did, store);
    await expect(first.publish("Saved draft")).rejects.toThrow(
      "draft is saved"
    );
    const original = first.pending;
    const reloaded = new PostPublisher(writer, reader, did, store);
    await expect(reloaded.publish("Different text")).rejects.toThrow(
      "draft is saved"
    );
    expect(reloaded.pending).toStrictEqual(original);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("blocks duplicate clicks while a request is running", async () => {
    const wait = Promise.withResolvers<null>();
    const write = vi.fn<FetchHandler>(async () => {
      await wait.promise;
      return Response.json({ cid: "test", uri: "at://post" });
    });
    const publisher = new PostPublisher(
      new Client({ handler: write }),
      new Client({
        handler: () => Promise.resolve(readResult(publisher.pending?.record)),
      }),
      did,
      storage()
    );
    const pending = publisher.publish("Once");
    await expect(publisher.publish("Twice")).rejects.toThrow(
      "already in progress"
    );
    wait.resolve(null);
    await pending;
    expect(write).toHaveBeenCalledOnce();
  });

  it("does not rewrite when an uncertain record cannot be checked or differs", async () => {
    const write = vi.fn<FetchHandler>(() =>
      Promise.reject(new Error("Timeout"))
    );
    const read = vi.fn<FetchHandler>(() =>
      Promise.resolve(Response.json({ error: "Unavailable" }, { status: 503 }))
    );
    const publisher = new PostPublisher(
      new Client({ handler: write }),
      new Client({ handler: read }),
      did,
      storage()
    );
    await expect(publisher.publish("Original")).rejects.toThrow("unknown");
    await expect(publisher.publish("Original")).rejects.toThrow("unknown");
    read.mockResolvedValue(readResult(createPost("Different")));
    await expect(publisher.check()).rejects.toThrow("different post");
    expect(write).toHaveBeenCalledOnce();
  });

  it("loads the newest ten record keys rather than the oldest or latest timestamps", async () => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      cid: "test",
      uri: `at://${did}/app.bsky.feed.post/${String(index + 1).padStart(2, "0")}`,
      value: {
        $type: "app.bsky.feed.post",
        createdAt: `2026-09-${String(12 - index).padStart(2, "0")}T00:00:00.000Z`,
        text: `Post ${index + 1}`,
      },
    }));
    const client = new Client({
      handler: (path) => {
        const url = new URL(path, "https://pds.test");
        // Standard PDS order is descending; reverse=true selects ascending keys.
        const ordered =
          url.searchParams.get("reverse") === "true"
            ? records
            : records.toReversed();
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return Promise.resolve(
          Response.json({ records: ordered.slice(0, limit) })
        );
      },
    });
    const posts = await getRecentPosts(client, did);
    expect(posts.map(({ record }) => record.text)).toStrictEqual([
      "Post 12",
      "Post 11",
      "Post 10",
      "Post 9",
      "Post 8",
      "Post 7",
      "Post 6",
      "Post 5",
      "Post 4",
      "Post 3",
    ]);
  });
});
