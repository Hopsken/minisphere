import { signOperation, validateIncomingOp } from "@atcute/did-plc";
import type { DidPlcString } from "@atcute/did-plc";
import { HTTPException } from "hono/http-exception";

import type { PatchPlc } from "../../schema/plc";
import type { PlcDirectoryClient } from "../clients/plc-directory-client";
import { decryptPlcRotationKey } from "../lib/plc-account";
import type { UserRepository } from "../repositories/user-repository";

type Head = Awaited<ReturnType<PlcDirectoryClient["getHead"]>>;

const view = (did: DidPlcString, head: Head) => ({
  alsoKnownAs: head.operation.alsoKnownAs,
  did,
  head: head.cid,
  rotationKeys: head.operation.rotationKeys,
  services: head.operation.services,
  verificationMethods: head.operation.verificationMethods,
});

const conflict = () =>
  new HTTPException(409, {
    message: "PLC head changed; read the current state before retrying",
  });

export class PlcService {
  private readonly users: Pick<UserRepository, "findAccountByUserId">;
  private readonly directory: Pick<
    PlcDirectoryClient,
    "getHead" | "submitOperation"
  >;
  private readonly encryptionSecret: string;

  constructor(
    users: Pick<UserRepository, "findAccountByUserId">,
    directory: Pick<PlcDirectoryClient, "getHead" | "submitOperation">,
    encryptionSecret: string
  ) {
    this.users = users;
    this.directory = directory;
    this.encryptionSecret = encryptionSecret;
  }

  private async account(userId: string) {
    const account = await this.users.findAccountByUserId(userId);
    if (account?.status !== "active" || !account.did) {
      throw new HTTPException(409, {
        message: "An active account is required",
      });
    }
    if (!/^did:plc:[a-z2-7]{24}$/u.test(account.did)) {
      throw new HTTPException(409, { message: "Account has no PLC identity" });
    }
    const did: DidPlcString = `did:plc:${account.did.slice(8)}`;
    return { ...account, did };
  }

  private async readHead(did: DidPlcString) {
    try {
      return await this.directory.getHead(did);
    } catch {
      // Do not send directory payloads or crypto errors to the error logger.
      throw new HTTPException(502, { message: "PLC state is unavailable" });
    }
  }

  async get(userId: string) {
    const account = await this.account(userId);
    return view(account.did, await this.readHead(account.did));
  }

  async patch(userId: string, input: PatchPlc) {
    const account = await this.account(userId);
    const head = await this.readHead(account.did);
    if (head.cid !== input.expectedHead) {
      throw conflict();
    }
    const current = head.operation;
    if (input.pdsEndpoint === current.services.atproto_pds?.endpoint) {
      return { ...view(account.did, head), changed: false };
    }

    let key;
    try {
      key = await decryptPlcRotationKey(userId, this.encryptionSecret, account);
    } catch {
      throw new HTTPException(503, {
        message: "Managed PLC key is unavailable",
      });
    }
    const managedKey = await key.exportPublicKey("did");
    if (!current.rotationKeys.includes(managedKey)) {
      throw new HTTPException(409, {
        message: "Managed key no longer has PLC update authority",
      });
    }
    // PLC accepts stale prev as recovery when the signer outranks the competing
    // signer. Only the lowest-priority key cannot accidentally recover a race.
    if (current.rotationKeys.at(-1) !== managedKey) {
      throw new HTTPException(409, {
        message: "Managed key must have lowest priority for a safe PLC update",
      });
    }
    const { sig: _sig, ...unsigned } = current;
    const operation = await signOperation(
      {
        ...unsigned,
        prev: head.cid,
        services: {
          ...current.services,
          atproto_pds: {
            ...current.services.atproto_pds,
            endpoint: input.pdsEndpoint,
            type:
              current.services.atproto_pds?.type ?? "AtprotoPersonalDataServer",
          },
        },
      },
      key
    );
    try {
      validateIncomingOp(operation);
    } catch {
      throw new HTTPException(400, {
        message: "Updated state exceeds PLC operation constraints",
      });
    }
    const latest = await this.readHead(account.did);
    if (latest.cid !== head.cid) {
      throw conflict();
    }
    try {
      await this.directory.submitOperation(account.did, operation);
    } catch {
      // A timeout or rejection does not prove that the write failed. Read once;
      // never sign or submit again within this request.
    }
    const observed = await this.readHead(account.did);
    if (
      observed.operation.sig === operation.sig &&
      observed.operation.prev === head.cid
    ) {
      return { ...view(account.did, observed), changed: true };
    }
    if (observed.cid !== head.cid) {
      throw conflict();
    }
    throw new HTTPException(503, {
      message:
        "PLC update outcome is unknown; read current state before retrying",
    });
  }
}
