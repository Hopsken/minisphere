import { and, eq } from "drizzle-orm";

import type { Database } from "../db";
import { atprotoAccount } from "../db/schema/atproto-account";

export class UserRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async reserveAccount(userId: string, username: string, operationId: string) {
    await this.db
      .insert(atprotoAccount)
      .values({
        operationId,
        userId,
        username,
      })
      .onConflictDoNothing();

    return this.findAccountByUserId(userId);
  }

  findAccountByUserId(userId: string) {
    return this.db
      .select()
      .from(atprotoAccount)
      .where(eq(atprotoAccount.userId, userId))
      .limit(1)
      .then(([account]) => account);
  }

  async isUsernameAvailable(username: string): Promise<boolean> {
    const [account] = await this.db
      .select({ username: atprotoAccount.username })
      .from(atprotoAccount)
      .where(eq(atprotoAccount.username, username))
      .limit(1);
    return !account;
  }

  async activateAccount(userId: string, operationId: string, did: string) {
    await this.db
      .update(atprotoAccount)
      .set({ did, status: "active" })
      .where(
        and(
          eq(atprotoAccount.userId, userId),
          eq(atprotoAccount.operationId, operationId),
          eq(atprotoAccount.status, "provisioning")
        )
      );

    return this.findAccountByUserId(userId);
  }

  async releaseProvisioningAccount(userId: string, operationId: string) {
    await this.db
      .delete(atprotoAccount)
      .where(
        and(
          eq(atprotoAccount.userId, userId),
          eq(atprotoAccount.operationId, operationId),
          eq(atprotoAccount.status, "provisioning")
        )
      );
  }

  async findDidByUsername(username: string): Promise<string | null> {
    const [account] = await this.db
      .select({ did: atprotoAccount.did })
      .from(atprotoAccount)
      .where(
        and(
          eq(atprotoAccount.status, "active"),
          eq(atprotoAccount.username, username)
        )
      )
      .limit(1);
    return account?.did ?? null;
  }
}
