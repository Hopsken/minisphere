import {
  parsePrivateMultikey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import type { DidKeyString } from "@atcute/did-plc";

import { KvKeyspace, pdsKvKeyspaces } from "../storage/kv-keyspace";

const SIGNING_KEY_RESERVATION_TTL_SECONDS = 2 * 60 * 60;

const importSigningKey = (signingKey: string) => {
  const parsedKey = parsePrivateMultikey(signingKey);
  if (parsedKey.type !== "secp256k1") {
    throw new Error("Reserved signing key must use secp256k1");
  }
  return Secp256k1PrivateKeyExportable.importRaw(parsedKey.privateKeyBytes);
};

export class SigningKeyReservationRepository {
  private readonly keys: KvKeyspace;

  constructor(kv: KVNamespace) {
    this.keys = new KvKeyspace(kv, pdsKvKeyspaces.reservedSigningKeys);
  }

  async reserve(did?: string): Promise<DidKeyString> {
    if (did) {
      const existing = await this.keys.get(did);
      if (existing) {
        const existingKey = await importSigningKey(existing);
        return existingKey.exportPublicKey("did");
      }
    }

    const key = await Secp256k1PrivateKeyExportable.createKeypair();
    const [privateKey, signingKey] = await Promise.all([
      key.exportPrivateKey("multikey"),
      key.exportPublicKey("did"),
    ]);
    await this.keys.put(did ?? signingKey, privateKey, {
      expirationTtl: SIGNING_KEY_RESERVATION_TTL_SECONDS,
    });
    return signingKey;
  }

  async get(did: string, signingKey: DidKeyString): Promise<string | null> {
    const reservationIds = [...new Set([did, signingKey])];
    const reservations = await Promise.all(
      reservationIds.map((reservationId) => this.keys.get(reservationId))
    );
    const reserved = reservations.find((reservation) => reservation !== null);
    if (!reserved) {
      return null;
    }

    const key = await importSigningKey(reserved);
    if ((await key.exportPublicKey("did")) !== signingKey) {
      throw new Error("Reserved signing key does not match PLC operation");
    }
    return reserved;
  }

  async delete(did: string, signingKey: DidKeyString): Promise<void> {
    await Promise.all(
      [...new Set([did, signingKey])].map((reservationId) =>
        this.keys.delete(reservationId)
      )
    );
  }
}
