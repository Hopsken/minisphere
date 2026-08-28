import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { Session } from "@/lib/auth-client";

interface AppShellProps {
  children: ReactNode;
  user: Session["user"] | null;
}

export const AppShell = ({ children, user }: AppShellProps) => (
  <div className="bg-background min-h-dvh p-3">
    <div className="mx-auto mb-8 flex max-w-lg flex-col items-center p-3">
      <header className="border-border bg-card mb-8 flex h-13 w-full rounded-xl px-4 py-2 shadow-xs">
        <div className="mx-auto flex w-full items-center justify-between">
          <Link
            to="/dashboard"
            className="font-heading text-lg font-semibold tracking-tight sm:text-xl"
          >
            minisphere
          </Link>

          {user ? (
            <div className="flex min-w-0 items-center gap-3">
              <span className="max-w-48 truncate text-sm font-medium sm:max-w-72">
                {user.name}
              </span>
              <Avatar aria-hidden="true">
                {user.image ? <AvatarImage src={user.image} alt="" /> : null}
                <AvatarFallback>
                  {user.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
          ) : (
            <Button variant={"ghost"} render={<Link to="/login" />} size="sm">
              Sign in
            </Button>
          )}
        </div>
      </header>

      <main className="flex w-full flex-col items-center gap-3 text-pretty">
        {children}
      </main>
    </div>
  </div>
);
