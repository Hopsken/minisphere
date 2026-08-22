const INVITE_CODE_BYTES = 32;
const INVITE_CODE_TTL_SECONDS = 2 * 60 * 60;

export class InviteCodeRepository {
  private static readonly keyPrefix = "invite:";

  private readonly kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  async create(): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_BYTES));
    const inviteCode = btoa(String.fromCodePoint(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");

    await this.kv.put(InviteCodeRepository.getKey(inviteCode), "1", {
      expirationTtl: INVITE_CODE_TTL_SECONDS,
    });
    return inviteCode;
  }

  async exists(inviteCode: string): Promise<boolean> {
    return (
      (await this.kv.get(InviteCodeRepository.getKey(inviteCode))) !== null
    );
  }

  delete(inviteCode: string): Promise<void> {
    return this.kv.delete(InviteCodeRepository.getKey(inviteCode));
  }

  private static getKey(inviteCode: string): string {
    return `${InviteCodeRepository.keyPrefix}${inviteCode}`;
  }
}
