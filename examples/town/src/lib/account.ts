import { AppBskyActorProfile } from "@atcute/bluesky";
import { Client, simpleFetchHandler } from "@atcute/client";
import { safeParse } from "@atcute/lexicons";
import {
  getSession,
  listStoredSessions,
  OAuthUserAgent,
} from "@atcute/oauth-browser-client";

export const loadAccount = async () => {
  const [did] = listStoredSessions();
  if (!did) {
    return null;
  }
  const session = await getSession(did);
  const agent = new OAuthUserAgent(session);
  const writer = new Client({ handler: agent });
  // Public repository reads go directly to the same discovered PDS without
  // credentials. No AppView, backend relay, or extra OAuth permission is needed.
  const reader = new Client({
    handler: simpleFetchHandler({ service: session.info.aud }),
  });
  const [repoResult, profileResult] = await Promise.allSettled([
    reader.get("com.atproto.repo.describeRepo", {
      params: { repo: did },
      signal: AbortSignal.timeout(15_000),
    }),
    reader.get("com.atproto.repo.getRecord", {
      params: { collection: "app.bsky.actor.profile", repo: did, rkey: "self" },
      signal: AbortSignal.timeout(15_000),
    }),
  ]);
  const repo = repoResult.status === "fulfilled" ? repoResult.value : null;
  const profile =
    profileResult.status === "fulfilled" ? profileResult.value : null;
  const parsed = profile?.ok
    ? safeParse(AppBskyActorProfile.mainSchema, profile.data.value)
    : null;
  const record = parsed?.ok ? parsed.value : null;
  const avatar = record?.avatar;
  return {
    agent,
    avatar: avatar
      ? `${session.info.aud}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ cid: avatar.ref.$link, did })}`
      : undefined,
    did,
    handle: repo?.ok ? repo.data.handle : did,
    name: record?.displayName,
    reader,
    writer,
  };
};

export type Account = NonNullable<Awaited<ReturnType<typeof loadAccount>>>;
