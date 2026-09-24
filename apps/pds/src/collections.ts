import * as Profile from "@atcute/bluesky/types/app/actor/profile";
import * as Post from "@atcute/bluesky/types/app/feed/post";
import type {
  RecordKeySchema,
  RecordObjectSchema,
  RecordSchema,
} from "@atcute/lexicons/validations";

// Schemas available for validation, not an allowlist of writable collections.
export const collectionSchemas: ReadonlyMap<
  string,
  RecordSchema<RecordObjectSchema, RecordKeySchema>
> = new Map(
  Object.entries({
    "app.bsky.actor.profile": Profile.mainSchema,
    "app.bsky.feed.post": Post.mainSchema,
  })
);
