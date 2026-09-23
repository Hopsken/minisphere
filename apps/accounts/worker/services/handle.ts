import type { UserRepository } from "../repositories/user-repository";

export class HandleService {
  private readonly users: UserRepository;
  private readonly suffix: string;

  constructor(users: UserRepository, handleDomain: string) {
    this.users = users;
    this.suffix = `.${handleDomain.toLowerCase()}`;
  }

  async resolve(handle: string): Promise<string | null> {
    const normalized = handle.toLowerCase();
    if (!normalized.endsWith(this.suffix)) {
      return null;
    }
    const username = normalized.slice(0, -this.suffix.length);
    if (!username || username.includes(".")) {
      return null;
    }
    return await this.users.findDidByUsername(username);
  }
}
