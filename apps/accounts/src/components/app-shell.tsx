import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { authKeys } from "@/features/auth/queries";
import { authClient } from "@/lib/auth-client";
import type { Session } from "@/lib/auth-client";

interface AppShellProps {
  children: ReactNode;
  user: Session["user"] | null;
}

export const AppShell = ({ children, user }: AppShellProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const signOut = async () => {
    await authClient.signOut();
    queryClient.setQueryData(authKeys.session, null);
    await navigate({ replace: true, to: "/login" });
  };

  return (
    <div className="bg-background min-h-dvh p-3">
      <div className="mx-auto flex min-h-[calc(100dvh-1.5rem)] max-w-lg flex-col items-center">
        <header className="border-border bg-card flex h-13 w-full rounded-xl px-4 py-2 shadow-xs">
          <div className="mx-auto flex w-full items-center justify-between">
            <Link
              to="/dashboard"
              className="font-heading text-lg font-semibold tracking-tight sm:text-xl"
            >
              minisphere
            </Link>

            {user ? (
              <details className="group relative">
                <summary className="focus-visible:ring-ring/30 cursor-pointer list-none rounded-full outline-none focus-visible:ring-3 [&::-webkit-details-marker]:hidden">
                  <Avatar>
                    {user.image ? (
                      <AvatarImage src={user.image} alt="" />
                    ) : null}
                    <AvatarFallback>
                      {user.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="sr-only">Account menu</span>
                </summary>
                <div className="border-border bg-popover absolute top-11 right-0 z-20 min-w-36 rounded-xl border p-1 shadow-md">
                  <Button
                    className="w-full justify-start"
                    onClick={signOut}
                    size="sm"
                    variant="ghost"
                  >
                    Sign out
                  </Button>
                </div>
              </details>
            ) : (
              <Avatar aria-hidden="true">
                <AvatarFallback />
              </Avatar>
            )}
          </div>
        </header>

        <main className="flex w-full flex-1 flex-col items-center gap-3 px-3 py-12 text-pretty sm:py-16">
          {children}
        </main>
      </div>
    </div>
  );
};
