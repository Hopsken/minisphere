import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { oauthSigningKey } from "../db/schema/oauth-signing-key";

export class OAuthSigningKeyRepository {
  private readonly db;

  constructor(d1: D1Database) {
    // Start on the primary; later reads must include this session's writes.
    this.db = drizzle(d1.withSession("first-primary"));
  }

  list() {
    return this.db.select().from(oauthSigningKey);
  }

  async initialize(key: typeof oauthSigningKey.$inferInsert) {
    // Never recreate a key when existing keys have been retired or disabled.
    // SQLite serializes this conditional write across all Worker instances.
    await this.db.run(sql`INSERT INTO oauth_signing_key
      (kid, status, public_x, public_y, encrypted_private_key, encryption_iv)
      SELECT ${key.kid}, 'current', ${key.publicX}, ${key.publicY},
        ${key.encryptedPrivateKey}, ${key.encryptionIv}
      WHERE NOT EXISTS (SELECT 1 FROM oauth_signing_key)`);
    return this.list();
  }
}
