import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface AppShellProps {
  children: ReactNode;
  user: {
    image?: string | null | undefined;
    name: string;
  } | null;
}

export const AppShell = ({ children, user }: AppShellProps) => (
  <div className="bg-background min-h-dvh">
    <header className="border-border bg-card border-b">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:h-18 sm:px-6">
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
        ) : null}
      </div>
    </header>

    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      {children}
    </main>
  </div>
);
