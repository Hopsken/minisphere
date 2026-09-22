import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { SubmitEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

const codeErrors = new Map([
  ["INVALID_OTP", "Incorrect or expired code."],
  ["OTP_EXPIRED", "Code expired. Request a new one."],
  ["TOO_MANY_ATTEMPTS", "Too many attempts. Request a new code."],
]);

export const EmailLoginForm = ({ returnTo }: { returnTo: string }) => {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [remaining, setRemaining] = useState(0);
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const previousStep = useRef(sentTo);

  useEffect(() => {
    if (previousStep.current !== sentTo) {
      const input = sentTo ? codeInput.current : emailInput.current;
      input?.focus();
      previousStep.current = sentTo;
    }
  }, [sentTo]);

  useEffect(() => {
    if (remaining === 0) {
      return;
    }
    const timer = window.setTimeout(() => setRemaining(remaining - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [remaining]);

  const send = useMutation({
    mutationFn: async () => {
      const address = (sentTo ?? email).trim().toLowerCase();
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: address,
        type: "sign-in",
      });
      if (result.error) {
        throw new Error(
          result.error.message ??
            "Could not send the login code. Try again later."
        );
      }
      setSentTo(address);
      setOtp("");
      setRemaining(60);
    },
    onError: () => {
      /* The form displays the error inline. */
    },
  });
  const signIn = useMutation({
    mutationFn: async () => {
      if (!sentTo) {
        return;
      }
      const result = await authClient.signIn.emailOtp({ email: sentTo, otp });
      if (result.error) {
        throw new Error(
          codeErrors.get(result.error.code ?? "") ??
            result.error.message ??
            "Could not sign in. Check the code and try again."
        );
      }
      // Reload so route guards read the new session, including OAuth return paths.
      window.location.assign(returnTo);
    },
    onError: () => {
      /* The form displays the error inline. */
    },
  });
  const pending = send.isPending || signIn.isPending;
  const error = send.error ?? signIn.error;
  let buttonLabel = sentTo ? "Sign in" : "Send code";
  if (send.isPending) {
    buttonLabel = "Sending code";
  } else if (signIn.isPending) {
    buttonLabel = "Signing in";
  }
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    send.reset();
    signIn.reset();
    if (sentTo) {
      signIn.mutate();
    } else {
      send.mutate();
    }
  };

  return (
    <>
      <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight">
        {sentTo ? "Check your email" : "Sign in"}
      </h1>
      {sentTo ? (
        <div className="mt-3 flex items-start gap-2 text-sm leading-6">
          <span className="text-foreground min-w-0 py-2 font-medium break-all">
            {sentTo}
          </span>
          <Button
            className="h-10 shrink-0 px-2"
            variant="link"
            disabled={pending}
            aria-label="Change email address"
            onClick={() => {
              setSentTo(null);
              setOtp("");
              send.reset();
              signIn.reset();
            }}
          >
            Change
          </Button>
        </div>
      ) : null}
      <form
        className="mt-8 flex w-full flex-col gap-5"
        onSubmit={submit}
        aria-busy={pending}
      >
        {sentTo ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="login-code" className="text-sm font-medium">
              Login code
            </label>
            <Input
              ref={codeInput}
              className="border-border bg-card h-13 rounded-xl border px-4 font-mono text-xl tracking-[0.3em] md:text-xl"
              key="code"
              id="login-code"
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              value={otp}
              onChange={(event) => {
                setOtp(event.target.value.replaceAll(/\D/gu, "").slice(0, 6));
                signIn.reset();
              }}
              required
              readOnly={pending}
              aria-invalid={!!signIn.error}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="login-email" className="text-sm font-medium">
              Email address
            </label>
            <Input
              ref={emailInput}
              className="border-border bg-card h-13 rounded-xl border px-4 text-base md:text-base"
              key="email"
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                send.reset();
              }}
              required
              readOnly={pending}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
        )}
        {error ? (
          <p
            id="login-error"
            role="alert"
            className="text-destructive text-sm leading-5"
          >
            {error.message}
          </p>
        ) : null}
        <Button
          className="h-12 w-full rounded-xl"
          type="submit"
          size="lg"
          disabled={pending}
        >
          {pending ? <Spinner /> : null}
          {buttonLabel}
        </Button>
      </form>
      {sentTo ? (
        <div className="mt-5 flex min-h-11 items-center justify-center text-sm">
          <Button
            variant="link"
            className="text-muted-foreground h-11 font-normal disabled:opacity-100"
            disabled={pending || remaining > 0}
            onClick={() => {
              signIn.reset();
              send.mutate();
            }}
          >
            {remaining > 0
              ? `Resend in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
              : "Resend code"}
          </Button>
        </div>
      ) : null}
    </>
  );
};
