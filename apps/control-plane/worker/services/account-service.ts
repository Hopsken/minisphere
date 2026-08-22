import { ComAtprotoServerCreateAccount } from "@atcute/atproto";
import type { Client as PdsClient } from "@atcute/client";
import { HTTPException } from "hono/http-exception";

import type { ManagedAccount } from "../../schema";
import type { Database } from "../db";
import { encryptCredential } from "../lib/credential";
import { randomBytes } from "../lib/random-bytes";
import { AccountRepository } from "../repositories/account";

const MACHINE_PASSWORD_BYTES = 32;

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
    const pdsHostname = new URL(env.PDS_ORIGIN).hostname;
    const handle: `${string}.${string}` = `${input.name}.${pdsHostname}`;
    const password = randomBytes(MACHINE_PASSWORD_BYTES);

    const response = await this.pdsClient.call(ComAtprotoServerCreateAccount, {
      input: {
        handle,
        inviteCode: input.inviteCode,
        password,
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
    const encryptedCredentials = await encryptCredential(
      password,
      env.CONTROL_PLANE_ENCRYPTION_KEY,
      did
    );
    await this.accountRepository.create({ did, encryptedCredentials });

    return response.data;
  }
}
