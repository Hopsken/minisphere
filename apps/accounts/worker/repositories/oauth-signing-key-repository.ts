import { notExists, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { oauthSigningKey } from "../db/schema/oauth-signing-key";

export class OAuthSigningKeyRepository {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  list() {
    return this.db.select().from(oauthSigningKey);
  }

  async initializeIfEmpty(
    key: Omit<typeof oauthSigningKey.$inferInsert, "status" | "createdAt">
  ) {
    // Never recreate a key when existing keys have been retired or disabled.
    // SQLite serializes this conditional write across all Worker instances.
    await this.db.insert(oauthSigningKey).select(
      this.db
        .select({
          encryptedPrivateKey: sql`${key.encryptedPrivateKey}`.as(
            "encrypted_private_key"
          ),
          encryptionIv: sql`${key.encryptionIv}`.as("encryption_iv"),
          kid: sql`${key.kid}`.as("kid"),
          publicX: sql`${key.publicX}`.as("public_x"),
          publicY: sql`${key.publicY}`.as("public_y"),
          status: sql`'current'`.as("status"),
        })
        // A single source row allows initialization when the key table is empty.
        .from(sql`(select 1)`)
        .where(notExists(this.db.select({ one: sql`1` }).from(oauthSigningKey)))
    );
    return this.list();
  }
}
