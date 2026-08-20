import { DurableObject } from "cloudflare:workers";

import { CoreStorage } from "./core";
import { createDatabase } from "./db";

export class PdsDurableObject extends DurableObject<Env> {
  private readonly core: CoreStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // initialize db and run migrations
    const { db, waitMigrations } = createDatabase(ctx.storage);
    void this.ctx.blockConcurrencyWhile(async () => {
      await Promise.resolve(waitMigrations());
    });

    this.core = new CoreStorage(db);
  }
}
