import { isHandle, isDid } from "@atcute/lexicons/syntax";
import z from "zod";

import { RESERVED_WORDS } from "./constants";
import type { Database } from "./db";
import { handlesTable } from "./db/schema";

export const registerHandleInputSchema = z.object({
  did: z.string().refine(isDid, { error: "Invalid did format" }),
  handle: z.string().refine(isHandle, { error: "Invalid handle format" }),
});

export type RegisterHandleInput = z.infer<typeof registerHandleInputSchema>;

export class Registry {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async exists(handle: string): Promise<boolean> {
    const row = await this.db.query.handlesTable.findFirst({
      where: { handle },
    });
    return !!row;
  }

  async getDidByHandle(handle: string): Promise<string | null> {
    const row = await this.db.query.handlesTable.findFirst({
      where: { handle },
    });
    return row?.did ?? null;
  }

  async register(input: RegisterHandleInput): Promise<void> {
    const { handle, did } = z.parse(registerHandleInputSchema, input);
    const [firstPart] = handle.split(".");

    if (!firstPart || RESERVED_WORDS.includes(firstPart)) {
      throw new Error("Handle is taken");
    }

    const existed = await this.exists(handle);

    if (existed) {
      throw new Error("Handle is taken");
    }

    await this.db.insert(handlesTable).values({ did, handle });
  }
}
