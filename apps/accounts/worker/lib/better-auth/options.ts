import type { BetterAuthOptions } from "better-auth";
import { username } from "better-auth/plugins/username";

/**
 * Custom options for Better Auth
 *
 * Docs: https://www.better-auth.com/docs/reference/options
 */
export const betterAuthOptions = {
  appName: "Minisphere",

  emailAndPassword: {
    disableSignUp: true,
    enabled: true,
  },

  plugins: [username()],

  user: {
    additionalFields: {
      did: {
        index: true,
        input: false,
        required: false,
        type: "string",
        unique: true,
      },
      type: {
        defaultValue: "user",
        input: false,
        required: false,
        type: "string",
      },
    },
  },
} satisfies BetterAuthOptions;
