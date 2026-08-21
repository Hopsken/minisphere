import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import z from "zod";

import { createDatabase } from "../db";
import { accountsTable, accountTypes } from "../db/schema";
import { PdsAccountError } from "./pds-client";
import {
  AccountAlreadyExistsError,
  createManagedAccount,
  toManagedAccount,
} from "./service";

const accountNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u, {
    message: "Use lowercase letters, numbers, and interior hyphens",
  });

export const createAccountSchema = z.object({
  accountType: z.enum(accountTypes),
  name: accountNameSchema,
});

interface WorkerEnv {
  Bindings: Env;
}

const accountsApi = new Hono<WorkerEnv>()
  .get("/", async (c) => {
    const accounts = await createDatabase(c.env.DB)
      .select()
      .from(accountsTable)
      .orderBy(desc(accountsTable.createdAt));
    return c.json({ accounts: accounts.map(toManagedAccount) }, 200);
  })
  .get("/:did", async (c) => {
    const [account] = await createDatabase(c.env.DB)
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.did, c.req.param("did")))
      .limit(1);
    if (!account) {
      return c.json({ error: "NotFound", message: "Account not found" }, 404);
    }
    return c.json({ account: toManagedAccount(account) }, 200);
  })
  .post("/", zValidator("json", createAccountSchema), async (c) => {
    try {
      const account = await createManagedAccount(c.req.valid("json"), c.env);
      return c.json({ account }, 201);
    } catch (error) {
      if (error instanceof AccountAlreadyExistsError) {
        return c.json({ error: "AccountExists", message: error.message }, 409);
      }
      if (error instanceof PdsAccountError) {
        let status: 409 | 422 | 502 = 422;
        if (error.code === "PdsUnavailable") {
          status = 502;
        } else if (error.code === "HandleNotAvailable") {
          status = 409;
        }
        return c.json({ error: error.code, message: error.message }, status);
      }
      throw error;
    }
  });

export default accountsApi;
