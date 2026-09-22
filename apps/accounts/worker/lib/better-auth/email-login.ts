import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { z } from "zod";

import { sendLoginCode } from "../../clients/resend";
import { isEmailAllowed } from "../email-allowlist";

export const emailLoginGuard = (env: Env) =>
  createAuthMiddleware(async (ctx) => {
    const sending = ctx.path === "/email-otp/send-verification-otp";
    if (!sending && ctx.path !== "/sign-in/email-otp") {
      return;
    }
    const parsed = z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email())
      .safeParse(ctx.body?.email);
    if (!parsed.success) {
      throw new APIError("BAD_REQUEST", {
        message: "Enter a valid email address.",
      });
    }
    const email = parsed.data;
    if (
      !isEmailAllowed(email, env.EMAIL_ALLOWLIST) ||
      (sending && ctx.body?.type !== "sign-in")
    ) {
      throw new APIError("FORBIDDEN", {
        message: "This email address is not allowed to sign in.",
      });
    }
    ctx.body.email = email;
    if (sending) {
      const adapter = ctx.context.internalAdapter;
      const identifier = `email-login-cooldown:${email}`;
      const previous = await adapter.findVerificationValue(identifier);
      if (
        (previous && previous.expiresAt.getTime() > Date.now()) ||
        !(await adapter.reserveVerificationValue({
          expiresAt: new Date(Date.now() + 60_000),
          identifier,
          value: "cooldown",
        }))
      ) {
        throw new APIError("TOO_MANY_REQUESTS", {
          message: "Wait 60 seconds before requesting another code.",
        });
      }
      // The verification table has no unique identifier constraint. Explicitly rotate.
      await adapter.deleteVerificationByIdentifier(`sign-in-otp-${email}`);
    }
  });

export const createEmailLogin = (env: Env) => {
  const failedDeliveries = new WeakSet<object>();
  const plugin = emailOTP({
    allowedAttempts: 5,
    expiresIn: 600,
    otpLength: 6,
    rateLimit: { max: 10, window: 60 },
    resendStrategy: "rotate",
    sendVerificationOTP: async ({ email, otp }, ctx) => {
      try {
        await sendLoginCode(env, email, otp);
      } catch {
        if (ctx) {
          failedDeliveries.add(ctx.context);
        }
      }
    },
    storeOTP: "hashed",
  });
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      after: [
        ...plugin.hooks.after,
        {
          handler: createAuthMiddleware(async (ctx) => {
            // Better Auth swallows delivery callback errors, even when awaited.
            if (failedDeliveries.has(ctx.context)) {
              await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                `sign-in-otp-${ctx.body.email}`
              );
              throw new APIError("BAD_GATEWAY", {
                message:
                  "Could not send the login code. Try again in a minute.",
              });
            }
          }),
          matcher: (ctx: { path?: string }) =>
            ctx.path === "/email-otp/send-verification-otp",
        },
      ],
    },
  };
};
