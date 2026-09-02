import { and, eq, gt, lte } from "drizzle-orm";

import type { PdsDatabase } from "../db";
import { accountInvitationsTable } from "../db/schema";

const INVITE_CODE_BYTES = 32;
const INVITE_CODE_TTL_SECONDS = 2 * 60 * 60;

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

export class InviteCodeRepository {
  private readonly db: PdsDatabase;

  constructor(db: PdsDatabase) {
    this.db = db;
  }

  async create(): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_BYTES));
    const inviteCode = toBase64Url(bytes);
    const now = Math.floor(Date.now() / 1000);

    await this.db.batch([
      this.db
        .delete(accountInvitationsTable)
        .where(lte(accountInvitationsTable.expires_at, now)),
      this.db.insert(accountInvitationsTable).values({
        code: inviteCode,
        expires_at: now + INVITE_CODE_TTL_SECONDS,
      }),
    ]);
    return inviteCode;
  }

  async claim(inviteCode: string): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const [claimed] = await this.db
      .delete(accountInvitationsTable)
      .where(
        and(
          eq(accountInvitationsTable.code, inviteCode),
          gt(accountInvitationsTable.expires_at, now)
        )
      )
      .returning({ code: accountInvitationsTable.code });
    if (claimed) {
      return true;
    }

    await this.db
      .delete(accountInvitationsTable)
      .where(
        and(
          eq(accountInvitationsTable.code, inviteCode),
          lte(accountInvitationsTable.expires_at, now)
        )
      );
    return false;
  }
}
