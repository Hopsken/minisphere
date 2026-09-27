import type { AppBskyActorDefs } from "@atcute/bluesky";

import type { PreferencesRepository } from "../repositories/preferences";
import { xrpcError } from "../utils/xrpc-error";

// Only full-access sessions may read or write personal details. No Minisphere
// session has full access, so the preference is never stored.
const FULL_ACCESS_ONLY = "app.bsky.actor.defs#personalDetailsPref";
// Derived by the PDS from personal details; clients cannot write it.
const READ_ONLY = "app.bsky.actor.defs#declaredAgePref";

/** Whole years from a `YYYY-MM-DD` birth date to today, in UTC. */
const ageOf = (birthDate: string) => {
  const [year = 0, month = 0, day = 0] = birthDate.split("-").map(Number);
  const today = new Date();
  const hadBirthday =
    today.getUTCMonth() + 1 > month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() >= day);
  return today.getUTCFullYear() - year - (hadBirthday ? 0 : 1);
};

export class Preferences {
  private readonly repository: PreferencesRepository;

  constructor(repository: PreferencesRepository) {
    this.repository = repository;
  }

  /**
   * The stored preferences, plus the age derived from the birth date. The
   * birth date itself needs full access, so it is never returned.
   */
  async get(did: string): Promise<AppBskyActorDefs.Preferences> {
    const { birthDate, preferences } = await this.repository.get(did);
    if (!birthDate) {
      return preferences;
    }
    const age = ageOf(birthDate);
    return [
      ...preferences,
      {
        $type: READ_ONLY,
        isOverAge13: age >= 13,
        isOverAge16: age >= 16,
        isOverAge18: age >= 18,
      },
    ];
  }

  async getBirthDate(did: string) {
    const { birthDate } = await this.repository.get(did);
    return birthDate;
  }

  /** Sets the birth date that the Accounts Settings page manages (ADR 0014). */
  setBirthDate(did: string, birthDate: string) {
    return this.repository.putBirthDate(did, birthDate);
  }

  /** Replaces every `app.bsky` preference of the account except the birth date. */
  async put(did: string, preferences: AppBskyActorDefs.Preferences) {
    const outside = preferences.filter(
      (preference) => !preference.$type.startsWith("app.bsky.")
    );
    if (outside.length > 0) {
      throw xrpcError(
        "InvalidRequest",
        "Some preferences are not in the app.bsky namespace"
      );
    }
    if (
      preferences.some((preference) => preference.$type === FULL_ACCESS_ONLY)
    ) {
      throw xrpcError(
        "InvalidRequest",
        `Do not have authorization to set preferences: ${FULL_ACCESS_ONLY}`
      );
    }
    await this.repository.put(
      did,
      preferences.filter((preference) => preference.$type !== READ_ONLY)
    );
  }
}
