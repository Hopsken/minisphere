import { Blobatar } from "@blobatar/react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Session } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  className?: string;
  user: Pick<Session["user"], "id" | "image">;
}

export const UserAvatar = ({ className, user }: UserAvatarProps) => (
  <Avatar aria-hidden="true" className={cn("after:hidden", className)}>
    {user.image ? <AvatarImage src={user.image} alt="" /> : null}
    <AvatarFallback className="bg-transparent">
      <Blobatar name={user.id} className="size-full" />
    </AvatarFallback>
  </Avatar>
);
