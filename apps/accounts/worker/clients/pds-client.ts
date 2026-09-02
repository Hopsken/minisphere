import { Client } from "@atcute/client";
import type { DidPlcString, Operation } from "@atcute/did-plc";

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
