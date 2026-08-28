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

    return response.data;
  }
}
