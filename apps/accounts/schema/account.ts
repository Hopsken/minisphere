import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Username must contain at least 2 characters")
  .max(63, "Username must contain at most 63 characters")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u, {
    message: "Use lowercase letters, numbers, and interior hyphens",
  });

export const createAccountSchema = z.strictObject({
  username: usernameSchema,
});
