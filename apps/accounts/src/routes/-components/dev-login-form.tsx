import { useState } from "react";
import type { SubmitEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DevLoginFormProps {
  returnTo: string;
}

export const DevLoginForm = ({ returnTo }: DevLoginFormProps) => {
  const [email, setEmail] = useState("");

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const loginURL = new URL(
      `/__dev/log-me-in/${encodeURIComponent(email.trim())}`,
      window.location.origin
    );
    loginURL.searchParams.set("returnTo", returnTo);
    window.location.assign(loginURL);
  };

  return (
    <details className="border-border border-t pt-3">
      <summary className="text-muted-foreground focus-visible:outline-ring cursor-pointer py-3 text-xs">
        Development tools
      </summary>
      <form
        className="mt-3 flex flex-col gap-3 sm:flex-row"
        onSubmit={handleSubmit}
      >
        <label htmlFor="dev-login-email" className="sr-only">
          Email address
        </label>
        <Input
          id="dev-login-email"
          name="email"
          type="email"
          placeholder="dev@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <Button type="submit" variant="outline">
          Dev login
        </Button>
      </form>
    </details>
  );
};
