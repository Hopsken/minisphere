import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { eq } from "drizzle-orm";

import { encodeBase64Url } from "../crypto/base64";
import { encryptText } from "../crypto/encryption";
import { createInviteCode } from "../crypto/invite-code";
import { createDatabase } from "../db";
import { accountsTable } from "../db/schema";
import type { Account } from "../db/schema";
import { createPdsAccount } from "./pds-client";

const MACHINE_PASSWORD_BYTES = 32;

export interface CreateManagedAccountInput {
  name: string;
}

interface StoredCredentials {
  recoveryKey: string;
  accessJwt: string;
  password: string;
  refreshJwt: string;
}

export interface ManagedAccount {
  createdAt: string;
  did: string;
  handle: string;
  pdsOrigin: string;
}

export class AccountAlreadyExistsError extends Error {
  constructor(handle: string) {
    super(`Account ${handle} is already managed by this Control Plane`);
    this.name = "AccountAlreadyExistsError";
  }
}

export const normalizePdsOrigin = (value: string): URL => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("PDS_ORIGIN must be an HTTPS origin without a path");
  }
  return new URL(url.origin.toLowerCase());
};

export const toManagedAccount = (account: Account): ManagedAccount => ({
  createdAt: account.createdAt.toISOString(),
  did: account.did,
  handle: account.handle,
  pdsOrigin: account.pdsOrigin,
});

const createMachinePassword = (): string =>
  encodeBase64Url(
    crypto.getRandomValues(new Uint8Array(MACHINE_PASSWORD_BYTES))
  );

export const createManagedAccount = async (
  input: CreateManagedAccountInput,
  env: Env,
  request: typeof globalThis.fetch = globalThis.fetch
): Promise<ManagedAccount> => {
  const pds = normalizePdsOrigin(env.PDS_ORIGIN);
  const handle: `${string}.${string}` = `${input.name}.${pds.hostname}`;
  const db = createDatabase(env.DB);
  const [existingAccount] = await db
    .select({ did: accountsTable.did })
    .from(accountsTable)
    .where(eq(accountsTable.handle, handle))
    .limit(1);
  if (existingAccount) {
    throw new AccountAlreadyExistsError(handle);
  }

  const password = createMachinePassword();
  const recoveryKey = await Secp256k1PrivateKeyExportable.createKeypair();
  const [inviteCode, recoveryKeyDid, recoveryKeyMultikey] = await Promise.all([
    createInviteCode(env.CONTROL_PLANE_INVITE_KEY, pds.origin),
    recoveryKey.exportPublicKey("did"),
    recoveryKey.exportPrivateKey("multikey"),
  ]);
  const created = await createPdsAccount(
    pds.origin,
    { handle, inviteCode, password, recoveryKey: recoveryKeyDid },
    request
  );

  const credentials: StoredCredentials = {
    accessJwt: created.accessJwt,
    password,
    recoveryKey: recoveryKeyMultikey,
    refreshJwt: created.refreshJwt,
  };
  const account: Account = {
    createdAt: new Date(),
    did: created.did,
    encryptedCredentials: await encryptText(
      JSON.stringify(credentials),
      env.CONTROL_PLANE_ENCRYPTION_KEY,
      created.did
    ),
    handle: created.handle,
    pdsOrigin: pds.origin,
  };
  await db.insert(accountsTable).values(account);
  return toManagedAccount(account);
};
