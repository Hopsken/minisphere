import { WorkerEntrypoint } from "cloudflare:workers";

import { createDatabase } from "./db";
import { Registry } from "./registry";
import type { RegisterHandleInput } from "./registry";

export class HandleRegistryEntrypoint extends WorkerEntrypoint<Env> {
  private registry: Registry;

  constructor(ctx: ExecutionContext, env: Env) {
    super(ctx, env);
    this.registry = new Registry(createDatabase(env.DB));
  }

  exists(handle: string) {
    return this.registry.exists(handle);
  }

  register({ handle, did }: RegisterHandleInput) {
    const domain = this.env.DOMAIN;

    if (!handle.endsWith(domain)) {
      throw new Error(`Handle must be in format: handle.${domain}`);
    }

    if (
      handle.split(".").length !==
      domain.split(".").filter(Boolean).length + 1
    ) {
      throw new Error(`Handle must be in format: handle.${domain}`);
    }

    return this.registry.register({ did, handle });
  }
}
