import type { BetterAuthOptions } from "better-auth";

/**
 * Custom options for Better Auth
 *
 * Docs: https://www.better-auth.com/docs/reference/options
 */
export const betterAuthOptions = {
  advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
  appName: "Minisphere",
  disabledPaths: [
    "/email-otp/check-verification-otp",
    "/email-otp/verify-email",
    "/email-otp/request-password-reset",
    "/email-otp/reset-password",
    "/forget-password/email-otp",
    "/email-otp/request-email-change",
    "/email-otp/change-email",
  ],
  rateLimit: {
    enabled: true,
    storage: "database",
  },
} satisfies BetterAuthOptions;
