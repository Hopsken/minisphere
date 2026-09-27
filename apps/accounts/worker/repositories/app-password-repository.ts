import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  appPassword,
  appPasswordRefreshToken,
} from "../db/schema/app-password";

export class AppPasswordRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  list(userId: string) {
    return this.db
      .select({
        createdAt: appPassword.createdAt,
        id: appPassword.id,
        name: appPassword.name,
        privileged: appPassword.privileged,
      })
      .from(appPassword)
      .where(eq(appPassword.userId, userId))
      .orderBy(desc(appPassword.createdAt));
  }

  /** Returns `undefined` when the user already has an app password with this name. */
  async create(value: typeof appPassword.$inferInsert) {
    const [created] = await this.db
      .insert(appPassword)
      .values(value)
      .onConflictDoNothing({ target: [appPassword.userId, appPassword.name] })
      .returning({
        createdAt: appPassword.createdAt,
        id: appPassword.id,
        name: appPassword.name,
        privileged: appPassword.privileged,
      });
    return created;
  }

  async revoke(userId: string, id: string) {
    const deleted = await this.db
      .delete(appPassword)
      .where(and(eq(appPassword.id, id), eq(appPassword.userId, userId)))
      .returning({ id: appPassword.id });
    return deleted.length > 0;
  }

  findByHash(userId: string, passwordHash: string) {
    return this.db
      .select({ id: appPassword.id, privileged: appPassword.privileged })
      .from(appPassword)
      .where(
        and(
          eq(appPassword.userId, userId),
          eq(appPassword.passwordHash, passwordHash)
        )
      )
      .limit(1)
      .then(([row]) => row);
  }

  async createRefreshToken(appPasswordId: string, expiresAt: number) {
    const id = crypto.randomUUID();
    await this.db.batch([
      this.db
        .delete(appPasswordRefreshToken)
        .where(
          and(
            eq(appPasswordRefreshToken.appPasswordId, appPasswordId),
            lte(
              appPasswordRefreshToken.expiresAt,
              Math.floor(Date.now() / 1000)
            )
          )
        ),
      this.db
        .insert(appPasswordRefreshToken)
        .values({ appPasswordId, expiresAt, id }),
    ]);
    return { expiresAt, id };
  }

  /** An unexpired refresh token together with its app password owner. */
  findRefreshToken(id: string, now: number) {
    return this.db
      .select({
        appPasswordId: appPasswordRefreshToken.appPasswordId,
        expiresAt: appPasswordRefreshToken.expiresAt,
        id: appPasswordRefreshToken.id,
        nextId: appPasswordRefreshToken.nextId,
        privileged: appPassword.privileged,
        userId: appPassword.userId,
      })
      .from(appPasswordRefreshToken)
      .innerJoin(
        appPassword,
        eq(appPassword.id, appPasswordRefreshToken.appPasswordId)
      )
      .where(
        and(
          eq(appPasswordRefreshToken.id, id),
          gt(appPasswordRefreshToken.expiresAt, now)
        )
      )
      .limit(1)
      .then(([row]) => row);
  }

  /**
   * Links an unrotated token to a new successor and shortens its lifetime to
   * `graceExpiresAt`. Both statements check `next_id IS NULL` in one
   * transaction, so concurrent rotations agree on a single successor.
   */
  async rotateRefreshToken(
    id: string,
    next: { expiresAt: number; id: string },
    graceExpiresAt: number
  ) {
    const unrotated = and(
      eq(appPasswordRefreshToken.id, id),
      isNull(appPasswordRefreshToken.nextId)
    );
    await this.db.batch([
      this.db.insert(appPasswordRefreshToken).select(
        this.db
          .select({
            appPasswordId: appPasswordRefreshToken.appPasswordId,
            expiresAt: sql`${next.expiresAt}`.as("expires_at"),
            id: sql`${next.id}`.as("id"),
            nextId: sql`null`.as("next_id"),
          })
          .from(appPasswordRefreshToken)
          .where(unrotated)
      ),
      this.db
        .update(appPasswordRefreshToken)
        .set({
          expiresAt: sql`min(${appPasswordRefreshToken.expiresAt}, ${graceExpiresAt})`,
          nextId: next.id,
        })
        .where(unrotated),
    ]);
  }

  async deleteRefreshToken(id: string) {
    await this.db
      .delete(appPasswordRefreshToken)
      .where(eq(appPasswordRefreshToken.id, id));
  }
}
