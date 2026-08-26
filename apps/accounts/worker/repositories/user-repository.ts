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
}
