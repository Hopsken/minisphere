import { WorkerEntrypoint } from "cloudflare:workers";

import { createDatabase } from "./db";
import { Registry } from "./registry";
import type { RegisterHandleInput } from "./registry";

export type Result<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      reason: string;
    };

export class HandleRegistryEntrypoint extends WorkerEntrypoint<Env> {
  private registry: Registry;

  constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env);
    this.registry = new Registry(createDatabase(env.DB));
  }

  exists(handle: string) {
    return this.registry.exists(handle);
  }

  async register({
    handle,
    did,
  }: RegisterHandleInput): Promise<Result<string>> {
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

    await this.registry.register({ did, handle });
    return { data: handle, ok: true };
  }
}
