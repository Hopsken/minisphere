import { ComAtprotoServerCreateAccount } from "@atcute/atproto";
import type { Client as PdsClient } from "@atcute/client";
import { HTTPException } from "hono/http-exception";

import type { ManagedAccount } from "../../schema";
import type { Database } from "../db";
import { AccountRepository } from "../repositories/account";

export class AccountService {
  private accountRepository: AccountRepository;
  private pdsClient: PdsClient;

  constructor(db: Database, pdsClient: PdsClient) {
    this.accountRepository = new AccountRepository(db);
    this.pdsClient = pdsClient;
  }

  listManagedAccounts(): Promise<ManagedAccount[]> {
    return this.accountRepository.list();
  }

  async createManagedAccount(
    env: Env,
    input: { name: string; inviteCode?: string }
  ) {
    const { pdsClient, accountRepository } = this;

    const handleDomain = env.HANDLE_DOMAIN.toLowerCase();
    const handle: `${string}.${string}` = `${input.name}.${handleDomain}`;

    const handleTaken = await env.HandleRegistry.exists(handle);

    if (handleTaken) {
      throw new HTTPException(409, { message: "Handle is taken" });
    }

    const response = await pdsClient.call(ComAtprotoServerCreateAccount, {
      input: {
        handle,
        inviteCode: input.inviteCode,
        recoveryKey: env.CONTROL_PLANE_ACCOUNT_RECOVERY_KEY,
      },
    });

    if (!response.ok) {
      throw new HTTPException(400, {
        cause: response.data.error,
        message: response.data.message ?? "PDS Error",
      });
    }

    const { did } = response.data;
    await accountRepository.create({ did });

    // Register handle
    const registration = await env.HandleRegistry.register({
      did,
      handle,
      // override should rarely happens since a previous check already confirms handle is not taken
      override: true,
    });
    if (!registration.ok) {
      throw new HTTPException(400, { message: registration.reason });
    }

    return response.data;
  }
}
