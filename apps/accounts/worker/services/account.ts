import { HTTPException } from "hono/http-exception";

import { PdsClient } from "../clients/pds-client";
import { PdsResponseError } from "../clients/pds-response-error";
import { PlcDirectoryClient } from "../clients/plc-directory-client";
import { createHostedHandle } from "../lib/hosted-handle";
import {
  createPlcAccountMaterial,
  restorePlcAccountMaterial,
} from "../lib/plc-account";
import type { PlcAccountMaterial } from "../lib/plc-account";
import type { UserRepository } from "../repositories/user-repository";

const accountView = (
  account:
    | Awaited<ReturnType<UserRepository["findAccountByUserId"]>>
    | undefined,
  handleDomain: string
) => {
  if (!account) {
    return { handleDomain, state: "needs_username" as const };
  }

  const handle = createHostedHandle(account.username, handleDomain);
  if (account.status === "provisioning") {
    return {
      handle,
      handleDomain,
      state: "provisioning" as const,
      username: account.username,
    };
  }
  if (!account.did) {
    throw new Error("Active AT Protocol account is missing its DID");
  }
  return {
    did: account.did,
    handle,
    handleDomain,
    state: "active" as const,
    username: account.username,
  };
};

export class AccountService {
  private readonly directory: PlcDirectoryClient;
  private readonly env: Env;
  private readonly pds: PdsClient;
  private readonly users: UserRepository;

  constructor(users: UserRepository, env: Env) {
    this.users = users;
    this.env = env;
    this.pds = new PdsClient(env.PDS);
    this.directory = new PlcDirectoryClient(env.PLC_DIRECTORY);
  }

  async getAccount(userId: string) {
    const account = await this.users.findAccountByUserId(userId);
    return accountView(account, this.env.PUBLIC_HANDLE_DOMAIN);
  }

  async createAccount(userId: string, username: string) {
    let account = await this.users.reserveAccount(userId, username);
    if (!account) {
      throw new HTTPException(409, { message: "Username is not available" });
    }
    if (account.username !== username) {
      throw new HTTPException(409, {
        message: "Account setup already uses a different username",
      });
    }
    if (account.status === "active") {
      return accountView(account, this.env.PUBLIC_HANDLE_DOMAIN);
    }

    const handle = createHostedHandle(
      account.username,
      this.env.PUBLIC_HANDLE_DOMAIN
    );
    if (!account.did && !account.signingKey) {
      try {
        const signingKey = await this.pds.reserveSigningKey();
        const prepared = await createPlcAccountMaterial(
          userId,
          this.env.ACCOUNTS_ENCRYPTION_KEY,
          handle,
          this.env.PDS_ORIGIN,
          signingKey
        );
        account = await this.users.saveProvisioningIdentity(
          userId,
          username,
          prepared
        );
      } catch (error) {
        await this.users.releaseEmptyProvisioningAccount(userId, username);
        if (error instanceof PdsResponseError) {
          throw new HTTPException(502, {
            message: "PDS signing-key reservation failed",
          });
        }
        throw error;
      }
    }
    if (account?.username !== username) {
      throw new HTTPException(409, {
        message: "Account reservation changed; retry setup",
      });
    }
    const material = await restorePlcAccountMaterial(
      userId,
      this.env.ACCOUNTS_ENCRYPTION_KEY,
      account
    );
    if (material.operation.alsoKnownAs[0] !== `at://${handle}`) {
      throw new Error(
        "Stored PLC handle does not match the configured handle domain"
      );
    }

    const status = await this.getProvisioningStatus(material, handle);
    if (status === "ready") {
      return this.activateAccount(userId, material.did);
    }
    if (status === "pending") {
      return accountView(account, this.env.PUBLIC_HANDLE_DOMAIN);
    }

    try {
      const inviteCode = await this.pds.generateInviteCode();
      const result = await this.pds.createAccount({
        did: material.did,
        handle,
        inviteCode,
        plcOp: material.operation,
      });
      if (result.did !== material.did) {
        throw new Error("PDS returned an unexpected DID");
      }
    } catch (error) {
      if (error instanceof PdsResponseError) {
        // Another request can still be creating this identity. A response error
        // does not prove that no concurrent request has caused external effects.
        if ((await this.getProvisioningStatus(material, handle)) === "ready") {
          return this.activateAccount(userId, material.did);
        }
        throw new HTTPException(502, {
          message: "PDS account creation failed",
        });
      }
      console.error(
        "AT Protocol account provisioning outcome is unknown",
        error
      );
    }

    return (await this.getProvisioningStatus(material, handle)) === "ready"
      ? this.activateAccount(userId, material.did)
      : accountView(account, this.env.PUBLIC_HANDLE_DOMAIN);
  }

  private async activateAccount(userId: string, did: string) {
    const active = await this.users.activateAccount(userId, did);
    return accountView(active, this.env.PUBLIC_HANDLE_DOMAIN);
  }

  private async getProvisioningStatus(
    material: PlcAccountMaterial,
    handle: `${string}.${string}`
  ): Promise<"missing" | "pending" | "ready"> {
    let repo: Awaited<ReturnType<PdsClient["getRepoStatus"]>>;
    try {
      repo = await this.pds.getRepoStatus(material.did);
    } catch (error) {
      console.error("PDS account status is not available", error);
      return "pending";
    }
    if (!repo.active) {
      return "status" in repo ? "pending" : "missing";
    }
    if (repo.did !== material.did) {
      console.error("PDS returned an unexpected repository DID");
      return "pending";
    }

    try {
      const plc = await this.directory.getState(material.did);
      const pdsService = plc.services.atproto_pds;
      return plc.did === material.did &&
        plc.alsoKnownAs.length === 1 &&
        plc.alsoKnownAs[0] === `at://${handle}` &&
        plc.rotationKeys.length === material.operation.rotationKeys.length &&
        plc.rotationKeys.every(
          (key, index) => key === material.operation.rotationKeys[index]
        ) &&
        plc.verificationMethods.atproto === material.signingKey &&
        pdsService?.type === "AtprotoPersonalDataServer" &&
        pdsService.endpoint ===
          material.operation.services.atproto_pds?.endpoint
        ? "ready"
        : "pending";
    } catch (error) {
      console.error("PLC account verification is not ready", error);
      return "pending";
    }
  }
}
