import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../db";
import { atprotoAccount } from "../db/schema/atproto-account";
import type { createPlcAccountMaterial } from "../lib/plc-account";
import { isReservedUsername } from "../lib/reserved-usernames";
import { UsernameUnavailableError } from "./username-unavailable-error";

export class UserRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async reserveAccount(userId: string, username: string) {
    if (isReservedUsername(username)) {
      throw new UsernameUnavailableError();
    }

    await this.db
      .insert(atprotoAccount)
      .values({
        userId,
        username,
      })
      .onConflictDoNothing();

    return this.findAccountByUserId(userId);
  }

  async saveProvisioningIdentity(
    userId: string,
    username: string,
    material: Awaited<ReturnType<typeof createPlcAccountMaterial>>
  ) {
    await this.db
      .update(atprotoAccount)
      .set(material)
      .where(
        and(
          eq(atprotoAccount.userId, userId),
          eq(atprotoAccount.username, username),
          eq(atprotoAccount.status, "provisioning"),
          isNull(atprotoAccount.did)
        )
      );

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
    if (isReservedUsername(username)) {
      return false;
    }

    const [account] = await this.db
      .select({ username: atprotoAccount.username })
      .from(atprotoAccount)
      .where(eq(atprotoAccount.username, username))
      .limit(1);
    return !account;
  }

  async activateAccount(userId: string, did: string) {
    await this.db
      .update(atprotoAccount)
      .set({ did, status: "active" })
      .where(
        and(
          eq(atprotoAccount.userId, userId),
          eq(atprotoAccount.did, did),
          eq(atprotoAccount.status, "provisioning")
        )
      );

    return this.findAccountByUserId(userId);
  }

  async releaseEmptyProvisioningAccount(userId: string, username: string) {
    await this.db
      .delete(atprotoAccount)
      .where(
        and(
          eq(atprotoAccount.userId, userId),
          eq(atprotoAccount.username, username),
          eq(atprotoAccount.status, "provisioning"),
          isNull(atprotoAccount.did)
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
