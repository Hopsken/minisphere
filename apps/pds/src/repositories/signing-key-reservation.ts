import {
  parsePrivateMultikey,
  Secp256k1PrivateKeyExportable,
} from "@atcute/crypto";
import type { DidKeyString } from "@atcute/did-plc";
import { and, eq, isNull, or } from "drizzle-orm";

import type { PdsDatabase } from "../db";
import { signingKeyReservationsTable } from "../db/schema";

const ENCRYPTION_IV_BYTES = 12;
const MINIMUM_ENCRYPTION_SECRET_LENGTH = 32;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

const importSigningKey = (signingKey: string) => {
  const parsedKey = parsePrivateMultikey(signingKey);
  if (parsedKey.type !== "secp256k1") {
    throw new Error("Reserved signing key must use secp256k1");
  }
  return Secp256k1PrivateKeyExportable.importRaw(parsedKey.privateKeyBytes);
};

const encodeBase64Url = (value: Uint8Array) => {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const decodeBase64Url = (value: string) => {
  if (!/^[A-Za-z\d_-]+$/u.test(value)) {
    throw new Error("Signing-key reservation contains invalid base64url");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
};

const importEncryptionKey = async (secret: string) => {
  if (secret.length < MINIMUM_ENCRYPTION_SECRET_LENGTH) {
    throw new Error(
      `PDS_SIGNING_KEY_ENCRYPTION_KEY must contain at least ${MINIMUM_ENCRYPTION_SECRET_LENGTH} characters`
    );
  }
  const keyBytes = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(secret)
  );
  return crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
};

const encryptPrivateKey = async (
  privateKey: string,
  signingKey: string,
  secret: string
) => {
  const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: encoder.encode(signingKey),
      iv,
      name: "AES-GCM",
    },
    await importEncryptionKey(secret),
    encoder.encode(privateKey)
  );
  return {
    encryptedPrivateKey: encodeBase64Url(new Uint8Array(ciphertext)),
    encryptionIv: encodeBase64Url(iv),
  };
};

const decryptPrivateKey = async (
  encryptedPrivateKey: string,
  encryptionIv: string,
  signingKey: string,
  secret: string
) => {
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: encoder.encode(signingKey),
      iv: decodeBase64Url(encryptionIv),
      name: "AES-GCM",
    },
    await importEncryptionKey(secret),
    decodeBase64Url(encryptedPrivateKey)
  );
  return decoder.decode(plaintext);
};

export class SigningKeyReservationRepository {
  private readonly database: PdsDatabase;
  private readonly encryptionSecret: string;

  constructor(database: PdsDatabase, encryptionSecret: string) {
    this.database = database;
    this.encryptionSecret = encryptionSecret;
  }

  async reserve(did?: string): Promise<DidKeyString> {
    if (did) {
      const existing =
        await this.database.query.signingKeyReservationsTable.findFirst({
          where: { did },
        });
      if (existing) {
        const existingKey = await importSigningKey(
          await decryptPrivateKey(
            existing.encryptedPrivateKey,
            existing.encryptionIv,
            existing.signingKey,
            this.encryptionSecret
          )
        );
        return existingKey.exportPublicKey("did");
      }
    }

    const key = await Secp256k1PrivateKeyExportable.createKeypair();
    const [privateKey, signingKey] = await Promise.all([
      key.exportPrivateKey("multikey"),
      key.exportPublicKey("did"),
    ]);
    const encrypted = await encryptPrivateKey(
      privateKey,
      signingKey,
      this.encryptionSecret
    );
    const reservation = {
      ...encrypted,
      claimedAt: did ? new Date() : null,
      did,
      signingKey,
    };
    if (!did) {
      await this.database
        .insert(signingKeyReservationsTable)
        .values(reservation);
      return signingKey;
    }

    const [inserted] = await this.database
      .insert(signingKeyReservationsTable)
      .values(reservation)
      .onConflictDoNothing()
      .returning({ signingKey: signingKeyReservationsTable.signingKey });
    if (inserted) {
      return signingKey;
    }
    return this.reserve(did);
  }

  async get(did: string, signingKey: DidKeyString): Promise<string | null> {
    const reservation =
      await this.database.query.signingKeyReservationsTable.findFirst({
        where: {
          AND: [{ signingKey }, { OR: [{ did: { isNull: true } }, { did }] }],
        },
      });
    if (!reservation) {
      return null;
    }

    const privateKey = await decryptPrivateKey(
      reservation.encryptedPrivateKey,
      reservation.encryptionIv,
      reservation.signingKey,
      this.encryptionSecret
    );
    const key = await importSigningKey(privateKey);
    if ((await key.exportPublicKey("did")) !== signingKey) {
      throw new Error("Reserved signing key does not match PLC operation");
    }
    return privateKey;
  }

  async claim(did: string, signingKey: DidKeyString): Promise<string | null> {
    const [reservation] = await this.database
      .update(signingKeyReservationsTable)
      .set({ claimedAt: new Date(), did })
      .where(
        and(
          eq(signingKeyReservationsTable.signingKey, signingKey),
          or(
            isNull(signingKeyReservationsTable.did),
            eq(signingKeyReservationsTable.did, did)
          )
        )
      )
      .returning();
    if (!reservation) {
      return null;
    }

    const privateKey = await decryptPrivateKey(
      reservation.encryptedPrivateKey,
      reservation.encryptionIv,
      reservation.signingKey,
      this.encryptionSecret
    );
    const key = await importSigningKey(privateKey);
    if ((await key.exportPublicKey("did")) !== signingKey) {
      throw new Error("Reserved signing key does not match PLC operation");
    }
    return privateKey;
  }
}
