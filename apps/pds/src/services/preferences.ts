import type { AppBskyActorDefs } from "@atcute/bluesky";

import type { PreferencesRepository } from "../repositories/preferences";
import { xrpcError } from "../utils/xrpc-error";

// Only full-access sessions may read or write personal details. No Minisphere
// session has full access, so the preference is never stored.
const FULL_ACCESS_ONLY = "app.bsky.actor.defs#personalDetailsPref";
// Derived by the PDS from personal details; clients cannot write it.
const READ_ONLY = "app.bsky.actor.defs#declaredAgePref";

export class Preferences {
  private readonly repository: PreferencesRepository;

  constructor(repository: PreferencesRepository) {
    this.repository = repository;
  }

  get(did: string) {
    return this.repository.get(did);
  }

  /** Replaces every `app.bsky` preference of the account. */
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
