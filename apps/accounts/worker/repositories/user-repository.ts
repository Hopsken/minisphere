import type { Database } from "../db";
import { usersToUsers } from "../db/schema/user-relationships";

export class UserRepository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async linkUser(ownerId: string, descendantId: string) {
    await this.db
      .insert(usersToUsers)
      .values({
        sourceUserId: ownerId,
        targetUserId: descendantId,
      })
      .onConflictDoNothing();
  }

  async listManagedAccounts(ownerId: string) {
    const account = await this.db.query.user.findFirst({
      where: { id: ownerId },
      with: {
        descendants: {
          columns: {
            did: true,
            id: true,
            username: true,
          },
        },
      },
    });

    return account?.descendants ?? [];
  }
}
