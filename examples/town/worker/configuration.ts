import { scope } from "@atcute/oauth-types";
import { z } from "zod";

export const townScope = [
  "atproto",
  scope.repo({ action: ["create"], collection: ["app.bsky.feed.post"] }),
  scope.repo({
    action: ["create", "update"],
    collection: ["app.bsky.actor.profile"],
  }),
  scope.blob({ accept: ["image/png", "image/jpeg"] }),
].join(" ");

export const configurationSchema = z.object({
  DEV_HANDLE_RESOLVER_ORIGIN: z.url({ protocol: /^https?$/u }).optional(),
  PLC_DIRECTORY: z
    .url({ protocol: /^https?$/u })
    .default("https://plc.directory"),
  PUBLIC_URL: z.url({ protocol: /^https?$/u }),
});
