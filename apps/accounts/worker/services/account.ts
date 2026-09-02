import { HTTPException } from "hono/http-exception";

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

  const handle = `${account.username}.${handleDomain}`;
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
  private readonly env: Env;
  private readonly users: UserRepository;

  constructor(users: UserRepository, env: Env) {
    this.users = users;
    this.env = env;
  }

  async getAccount(userId: string) {
    const account = await this.users.findAccountByUserId(userId);
    return accountView(account, this.env.PUBLIC_HANDLE_DOMAIN);
  }

  async createAccount(userId: string, username: string) {
    const operationId = crypto.randomUUID();
    const account = await this.users.reserveAccount(
      userId,
      username,
      operationId
    );
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

    const handle = `${account.username}.${this.env.PUBLIC_HANDLE_DOMAIN}`;
    try {
      const result = await this.env.PDS.createAccount({
        handle,
        operationId: account.operationId,
        recoveryKey: this.env.ACCOUNTS_ACCOUNT_RECOVERY_KEY,
      });
      if (result.status === "failed") {
        await this.users.releaseProvisioningAccount(
          userId,
          account.operationId
        );
        throw new HTTPException(409, {
          message: "Username is not available",
        });
      }

      const active = await this.users.activateAccount(
        userId,
        account.operationId,
        result.did
      );
      return accountView(active, this.env.PUBLIC_HANDLE_DOMAIN);
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      console.error(
        "AT Protocol account provisioning outcome is unknown",
        error
      );
      return accountView(account, this.env.PUBLIC_HANDLE_DOMAIN);
    }
  }
}
