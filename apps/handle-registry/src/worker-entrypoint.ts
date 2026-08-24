import { WorkerEntrypoint } from "cloudflare:workers";

import { createDatabase } from "./db";
import { Registry } from "./registry";
import type { RegisterHandleInput } from "./registry";

interface HandleRegistryEnv {
  DB: D1Database;
  DOMAIN: string;
}

export type Result<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      reason: string;
    };

export class HandleRegistryEntrypoint extends WorkerEntrypoint<HandleRegistryEnv> {
  private registry: Registry;

  constructor(ctx: ExecutionContext, env: HandleRegistryEnv) {
    super(ctx, env);
    this.registry = new Registry(createDatabase(env.DB));
  }

  exists(handle: string) {
    return this.registry.exists(handle);
  }

  async register(input: RegisterHandleInput): Promise<Result<string>> {
    const { handle } = input;
    const domain = this.env.DOMAIN;

    if (!handle.endsWith(domain)) {
      return {
        ok: false,
        reason: `Handle must be in format: handle.${domain}`,
      };
    }

    const [, ...handleDomainParts] = handle.split(".");
    if (handleDomainParts.join(".") !== domain) {
      return {
        ok: false,
        reason: `Handle must be in format: handle.${domain}`,
      };
    }

    await this.registry.register(input);
    return { data: handle, ok: true };
  }
}
