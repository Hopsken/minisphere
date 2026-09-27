import { z } from "zod";

export const createAppPasswordSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name")
    .max(64, "Name must contain at most 64 characters"),
  privileged: z.boolean(),
});

export type CreateAppPassword = z.infer<typeof createAppPasswordSchema>;
