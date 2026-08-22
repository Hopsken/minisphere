import { KvKeyspace, pdsKvKeyspaces } from "../storage/kv-keyspace";

const INVITE_CODE_BYTES = 32;
const INVITE_CODE_TTL_SECONDS = 2 * 60 * 60;

export class InviteCodeRepository {
  private readonly codes: KvKeyspace;

  constructor(kv: KVNamespace) {
    this.codes = new KvKeyspace(kv, pdsKvKeyspaces.inviteCodes);
  }

  async create(): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_BYTES));
    const inviteCode = btoa(String.fromCodePoint(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");

    await this.codes.put(inviteCode, "1", {
      expirationTtl: INVITE_CODE_TTL_SECONDS,
    });
    return inviteCode;
  }

  exists(inviteCode: string): Promise<boolean> {
    return this.codes.has(inviteCode);
  }

  delete(inviteCode: string): Promise<void> {
    return this.codes.delete(inviteCode);
  }
}
