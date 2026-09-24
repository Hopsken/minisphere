import { AppBskyActorProfile } from "@atcute/bluesky";
import { Client, simpleFetchHandler } from "@atcute/client";
import type { DidPlcString, Operation } from "@atcute/did-plc";
import { safeParse } from "@atcute/lexicons";

import { PdsResponseError } from "./pds-response-error";

export class PdsClient {
  private readonly client: Client;
  private readonly service: Env["PDS"];

  constructor(service: Env["PDS"]) {
    this.service = service;
    this.client = new Client({
      handler: (pathname, init) =>
        service.fetch(
          new Request(`https://minisphere-pds.service${pathname}`, init)
        ),
    });
  }

  generateInviteCode(): Promise<string> {
    return this.service.generateInviteCode();
  }

  async getProfile(
    did: DidPlcString,
    endpoint: string,
    hostedEndpoint: string
  ) {
    const origin = new URL(endpoint);
    const hosted = endpoint === hostedEndpoint;
    if (
      origin.origin !== endpoint ||
      (!hosted && origin.protocol !== "https:")
    ) {
      return null;
    }
    // Use the binding only for our PDS; a moved account follows its live PLC endpoint.
    const reader = hosted
      ? this.client
      : new Client({
          handler: simpleFetchHandler({ service: endpoint }),
        });
    const response = await reader.get("com.atproto.repo.getRecord", {
      params: { collection: "app.bsky.actor.profile", repo: did, rkey: "self" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return null;
    }
    const parsed = safeParse(
      AppBskyActorProfile.mainSchema,
      response.data.value
    );
    if (!parsed.ok) {
      return null;
    }
    const { avatar, description, displayName } = parsed.value;
    let avatarUrl: string | null = null;
    if (avatar) {
      const url = new URL("/xrpc/com.atproto.sync.getBlob", origin);
      url.search = new URLSearchParams({
        cid: avatar.ref.$link,
        did,
      }).toString();
      avatarUrl = url.href;
    }
    return {
      avatar: avatarUrl,
      description: description ?? null,
      displayName: displayName ?? null,
    };
  }

  async reserveSigningKey(): Promise<string> {
    const response = await this.client.post(
      "com.atproto.server.reserveSigningKey",
      { input: {} }
    );
    if (!response.ok) {
      throw new PdsResponseError(
        response.status,
        response.data.message ?? "PDS signing-key reservation failed"
      );
    }
    return response.data.signingKey;
  }

  async createAccount(input: {
    did: DidPlcString;
    handle: `${string}.${string}`;
    inviteCode: string;
    plcOp: Operation;
  }) {
    const response = await this.client.post(
      "com.atproto.server.createAccount",
      {
        input: { ...input, plcOp: { ...input.plcOp } },
      }
    );
    if (!response.ok) {
      throw new PdsResponseError(
        response.status,
        response.data.message ?? "PDS account creation failed"
      );
    }
    return response.data;
  }

  async getRepoStatus(did: DidPlcString) {
    const response = await this.client.get("com.atproto.sync.getRepoStatus", {
      params: { did },
    });
    if (!response.ok) {
      throw new PdsResponseError(
        response.status,
        response.data.message ?? "PDS repository status request failed"
      );
    }
    return response.data;
  }
}
