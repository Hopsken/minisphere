import type { PdsDatabase } from "../db";

export class AccountRepository {
  private readonly db: PdsDatabase;

  constructor(db: PdsDatabase) {
    this.db = db;
  }

  async exists(did: string): Promise<boolean> {
    const account = await this.db.query.accountsTable.findFirst({
      columns: { did: true },
      where: { did },
    });
    return account !== undefined;
  }
}
