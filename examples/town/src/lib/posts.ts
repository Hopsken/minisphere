import "@atcute/atproto";
import { AppBskyFeedPost } from "@atcute/bluesky";
import type { Client } from "@atcute/client";
import { parse } from "@atcute/lexicons";
import type { Did } from "@atcute/lexicons";
import { now } from "@atcute/tid";
import { z } from "zod";

const collection = "app.bsky.feed.post";
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const countGraphemes = (text: string) =>
  [...segmenter.segment(text)].length;

export const createPost = (text: string) => {
  if (!text.trim()) {
    throw new Error("Write something before posting.");
  }
  return parse(AppBskyFeedPost.mainSchema, {
    $type: collection,
    createdAt: new Date().toISOString(),
    text,
  });
};

export const postValidationError = (text: string) => {
  try {
    createPost(text);
    return null;
  } catch {
    return text.trim()
      ? "Use at most 300 characters and 3,000 UTF-8 bytes."
      : "Write something before posting.";
  }
};

export const canCreatePost = (scope: string) =>
  scope.split(" ").some((value) => {
    const [resource, query] = value.split("?");
    const params = new URLSearchParams(query);
    let collections: string[] = [];
    if (resource === "repo") {
      collections = params.getAll("collection");
    } else if (resource?.startsWith("repo:")) {
      collections = [resource.slice(5)];
    }
    return (
      collections.includes(collection) &&
      params.getAll("action").includes("create")
    );
  });

export interface Post {
  uri: string;
  record: AppBskyFeedPost.Main;
}

const pendingSchema = z.object({
  confirmed: z.boolean(),
  record: z
    .unknown()
    .transform((value) => parse(AppBskyFeedPost.mainSchema, value)),
  rkey: z.string().regex(/^[234567a-z]{13}$/u),
});
type PendingPost = z.infer<typeof pendingSchema>;

export const getRecentPosts = async (
  client: Client,
  did: Did
): Promise<Post[]> => {
  const response = await client.get("com.atproto.repo.listRecords", {
    params: { collection, limit: 10, repo: did, reverse: true },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error("Could not load your recent posts. Try again.");
  }
  return response.data.records.map(({ uri, value }) => ({
    record: parse(AppBskyFeedPost.mainSchema, value),
    uri,
  }));
};

// Persist the operation before sending it. A reload must not turn an uncertain
// write into a new record. Retrying createRecord always uses the same TID.
export class PostPublisher {
  pending: PendingPost | null;
  canRetry = false;
  private busy = false;
  private readonly storageKey: string;
  private readonly writer: Client;
  private readonly reader: Client;
  private readonly did: Did;
  private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;

  constructor(
    writer: Client,
    reader: Client,
    did: Did,
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem">
  ) {
    this.writer = writer;
    this.reader = reader;
    this.did = did;
    this.storage = storage;
    this.storageKey = `town:pending:${did}`;
    const saved = storage.getItem(this.storageKey);
    this.pending = saved ? pendingSchema.parse(JSON.parse(saved)) : null;
  }

  private save(pending: PendingPost) {
    this.storage.setItem(this.storageKey, JSON.stringify(pending));
    this.pending = pending;
  }

  private async readPending(): Promise<Post | null> {
    const { pending } = this;
    if (!pending) {
      return null;
    }
    this.canRetry = false;
    const readFailure = pending.confirmed
      ? "Posted, but the post could not be read back. Retry reading; do not post again."
      : "The result is unknown. Check the post before trying again. Your draft is saved.";
    let response;
    try {
      response = await this.reader.get("com.atproto.repo.getRecord", {
        params: { collection, repo: this.did, rkey: pending.rkey },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(readFailure, { cause: error });
    }
    if (!response.ok) {
      if (response.data.error === "RecordNotFound" && !pending.confirmed) {
        this.canRetry = true;
        return null;
      }
      throw new Error(readFailure);
    }
    const record = parse(AppBskyFeedPost.mainSchema, response.data.value);
    if (
      record.text !== pending.record.text ||
      record.createdAt !== pending.record.createdAt
    ) {
      throw new Error(
        "This record key contains a different post. Nothing was overwritten."
      );
    }
    this.storage.removeItem(this.storageKey);
    this.pending = null;
    this.canRetry = false;
    return { record, uri: response.data.uri };
  }

  async check(): Promise<Post | null> {
    if (this.busy) {
      throw new Error("A post request is already in progress.");
    }
    this.busy = true;
    try {
      return await this.readPending();
    } finally {
      this.busy = false;
    }
  }

  async publish(text: string): Promise<Post> {
    if (this.busy) {
      throw new Error("A post request is already in progress.");
    }
    this.busy = true;
    try {
      if (this.pending) {
        const existing = await this.readPending();
        if (existing) {
          return existing;
        }
      } else {
        this.save({ confirmed: false, record: createPost(text), rkey: now() });
      }
      const { pending } = this;
      if (!pending) {
        throw new Error("No pending post.");
      }
      this.canRetry = false;
      try {
        const response = await this.writer.post(
          "com.atproto.repo.createRecord",
          {
            input: {
              collection,
              record: pending.record,
              repo: this.did,
              rkey: pending.rkey,
              validate: true,
            },
            signal: AbortSignal.timeout(20_000),
          }
        );
        if (!response.ok) {
          throw new Error(response.data.message ?? response.data.error);
        }
        this.save({ ...pending, confirmed: true });
      } catch (error) {
        const recovered = await this.readPending();
        if (recovered) {
          return recovered;
        }
        throw new Error(
          `Post not found. Your draft is saved. Retry this same post. ${error instanceof Error ? error.message : "Request failed."}`,
          { cause: error }
        );
      }
      const post = await this.readPending();
      if (!post) {
        throw new Error("The post could not be read back.");
      }
      return post;
    } finally {
      this.busy = false;
    }
  }
}
