import { and, eq, gt, lte } from "drizzle-orm";

import type { PdsDatabase } from "../db";
import { dpopStateTable } from "../db/schema";

export class DpopStateRepository {
  private readonly db: PdsDatabase;

  constructor(db: PdsDatabase) {
    this.db = db;
  }

  async createNonce(): Promise<string> {
    const nonce = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    await this.db.batch([
      this.db.delete(dpopStateTable).where(lte(dpopStateTable.expiresAt, now)),
      this.db.insert(dpopStateTable).values({
        expiresAt: now + 300,
        key: `nonce:${nonce}`,
      }),
    ]);
    return nonce;
  }

  async hasNonce(nonce: string): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(dpopStateTable)
      .where(
        and(
          eq(dpopStateTable.key, `nonce:${nonce}`),
          gt(dpopStateTable.expiresAt, Math.floor(Date.now() / 1000))
        )
      );
    return row !== undefined;
  }

  async claimProof(jkt: string, jti: string): Promise<boolean> {
    const [row] = await this.db
      .insert(dpopStateTable)
      .values({
        expiresAt: Math.floor(Date.now() / 1000) + 300,
        key: `proof:${jkt}:${jti}`,
      })
      .onConflictDoNothing()
      .returning({ key: dpopStateTable.key });
    return row !== undefined;
  }
}
