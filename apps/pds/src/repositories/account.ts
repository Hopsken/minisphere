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

  /** Hosted DIDs in ascending order, after `cursor` when given. */
  async list(limit: number, cursor?: string): Promise<string[]> {
    const accounts = await this.db.query.accountsTable.findMany({
      columns: { did: true },
      limit,
      orderBy: { did: "asc" },
      // Every DID sorts after the empty string.
      where: { did: { gt: cursor ?? "" } },
    });
    return accounts.map((account) => account.did);
  }
}
