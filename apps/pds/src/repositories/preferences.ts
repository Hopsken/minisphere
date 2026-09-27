import type { AppBskyActorDefs } from "@atcute/bluesky";
import { eq } from "drizzle-orm";

import type { PdsDatabase } from "../db";
import { accountPreferencesTable } from "../db/schema";

export class PreferencesRepository {
  private readonly db: PdsDatabase;

  constructor(db: PdsDatabase) {
    this.db = db;
  }

  async get(did: string): Promise<AppBskyActorDefs.Preferences> {
    const [row] = await this.db
      .select({ preferences: accountPreferencesTable.preferences })
      .from(accountPreferencesTable)
      .where(eq(accountPreferencesTable.did, did));
    return row?.preferences ?? [];
  }

  async put(did: string, preferences: AppBskyActorDefs.Preferences) {
    await this.db
      .insert(accountPreferencesTable)
      .values({ did, preferences })
      .onConflictDoUpdate({
        set: { preferences },
        target: accountPreferencesTable.did,
      });
  }
}
