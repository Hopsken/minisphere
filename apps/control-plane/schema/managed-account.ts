import { isDid } from "@atcute/lexicons/syntax";
import { z } from "zod";

export const ManagedAccountSchema = z.object({
  did: z.string().min(1).refine(isDid),
});

export type ManagedAccount = z.infer<typeof ManagedAccountSchema>;

const accountNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u, {
    message: "Use lowercase letters, numbers, and interior hyphens",
  });

export const CreateAccountInputSchema = z.object({
  name: accountNameSchema,
});
