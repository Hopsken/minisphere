import type { Did } from "@atcute/lexicons";

import type { ManagedAccount } from "../../schema";
import type { Database } from "../db";
import { accountsTable } from "../db/schema";
import type { AccountRow } from "../db/schema";

export class AccountRepository {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async list(): Promise<ManagedAccount[]> {
    const rows = await this.db
      .select({ did: accountsTable.did })
      .from(accountsTable);

    // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
    return rows.map((r) => ({ did: r.did as Did }));
  }

  async create(account: Omit<AccountRow, "createdAt">) {
    await this.db.insert(accountsTable).values(account);
  }
}
