import type { AppBskyActorDefs } from "@atcute/bluesky";
import { eq } from "drizzle-orm";

import type { PdsDatabase } from "../db";
import { accountPreferencesTable } from "../db/schema";

export class PreferencesRepository {
  private readonly db: PdsDatabase;

  constructor(db: PdsDatabase) {
    this.db = db;
  }

  async get(did: string) {
    const [row] = await this.db
      .select({
        birthDate: accountPreferencesTable.birthDate,
        preferences: accountPreferencesTable.preferences,
      })
      .from(accountPreferencesTable)
      .where(eq(accountPreferencesTable.did, did));
    return row ?? { birthDate: null, preferences: [] };
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

  async putBirthDate(did: string, birthDate: string) {
    await this.db
      .insert(accountPreferencesTable)
      .values({ birthDate, did, preferences: [] })
      .onConflictDoUpdate({
        set: { birthDate },
        target: accountPreferencesTable.did,
      });
  }
}
