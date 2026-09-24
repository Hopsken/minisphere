import "@atcute/atproto";
import { AppBskyActorProfile } from "@atcute/bluesky";
import type { Client } from "@atcute/client";
import { parse } from "@atcute/lexicons";
import type { Did } from "@atcute/lexicons";
import { z } from "zod";

const collection = "app.bsky.actor.profile";

export const readProfile = async (reader: Client, did: Did) => {
  const response = await reader.get("com.atproto.repo.getRecord", {
    params: { collection, repo: did, rkey: "self" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.data.error === "RecordNotFound") {
      return {
        cid: null,
        record: parse(AppBskyActorProfile.mainSchema, { $type: collection }),
      };
    }
    throw new Error("Could not load your profile. Try again.");
  }
  const raw = z.record(z.string(), z.unknown()).parse(response.data.value);
  // Keep unknown fields as well as the fields understood by this client.
  return {
    cid: response.data.cid,
    record: { ...raw, ...parse(AppBskyActorProfile.mainSchema, raw) },
  };
};

export type ProfileSnapshot = Awaited<ReturnType<typeof readProfile>>;

export const uploadAvatar = async (writer: Client, image: File) => {
  const response = await writer.post("com.atproto.repo.uploadBlob", {
    headers: { "Content-Type": image.type },
    input: image,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error("Could not upload the image. Try again.");
  }
  return response.data.blob;
};

export const putProfile = async (
  writer: Client,
  did: Did,
  snapshot: ProfileSnapshot,
  record: AppBskyActorProfile.Main
) => {
  const response = await writer.post("com.atproto.repo.putRecord", {
    input: {
      collection,
      record,
      repo: did,
      rkey: "self",
      swapRecord: snapshot.cid,
      validate: true,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(
      response.data.error === "InvalidSwap"
        ? "Your profile changed elsewhere. Reload it before saving again."
        : "Could not save your profile. Reload it before trying again."
    );
  }
};
