import { HTTPException } from "hono/http-exception";

import type { CreateAppPassword } from "../../schema/app-password";
import { encodeBase64Url } from "../lib/jwt";
import type { AppPasswordRepository } from "../repositories/app-password-repository";

const alphabet = "abcdefghijklmnopqrstuvwxyz234567";

/** An 80-bit secret in the `xxxx-xxxx-xxxx-xxxx` app-password format. */
const generateAppPassword = () => {
  // 256 is a multiple of 32, so `byte % 32` is unbiased.
  const chars = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte) => alphabet[byte % alphabet.length]
  ).join("");
  return chars.match(/.{4}/gu)?.join("-") ?? chars;
};

// A generated secret has enough entropy that a fast hash cannot be reversed.
export const hashAppPassword = async (password: string) =>
  encodeBase64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password))
    )
  );

export class AppPasswords {
  private readonly repository: AppPasswordRepository;

  constructor(repository: AppPasswordRepository) {
    this.repository = repository;
  }

  list(userId: string) {
    return this.repository.list(userId);
  }

  async create(userId: string, input: CreateAppPassword) {
    const password = generateAppPassword();
    const created = await this.repository.create({
      id: crypto.randomUUID(),
      name: input.name,
      passwordHash: await hashAppPassword(password),
      privileged: input.privileged,
      userId,
    });
    if (!created) {
      throw new HTTPException(409, {
        message: "An app password with this name already exists.",
      });
    }
    return { ...created, password };
  }

  async revoke(userId: string, id: string) {
    if (!(await this.repository.revoke(userId, id))) {
      throw new HTTPException(404, { message: "App password not found." });
    }
  }
}
