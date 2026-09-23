import { z } from "zod";

export const townScope =
  "atproto repo?collection=app.bsky.feed.post&action=create";

export const configurationSchema = z.object({
  DEV_HANDLE_RESOLVER_ORIGIN: z.url({ protocol: /^https?$/u }).optional(),
  PLC_DIRECTORY: z
    .url({ protocol: /^https?$/u })
    .default("https://plc.directory"),
  PUBLIC_URL: z.url({ protocol: /^https?$/u }),
});
