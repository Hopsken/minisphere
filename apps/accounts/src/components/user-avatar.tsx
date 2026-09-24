import { Blobatar } from "@blobatar/react";
import { useQuery } from "@tanstack/react-query";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { accountProfileQuery } from "@/features/account/profile";
import type { Session } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  className?: string;
  user: Pick<Session["user"], "id">;
}

export const UserAvatar = ({ className, user }: UserAvatarProps) => {
  const { data: profile } = useQuery(accountProfileQuery(user.id));
  return (
    <Avatar aria-hidden="true" className={cn("after:hidden", className)}>
      {profile?.avatar ? <AvatarImage src={profile.avatar} alt="" /> : null}
      <AvatarFallback className="bg-transparent">
        <Blobatar name={user.id} className="size-full" />
      </AvatarFallback>
    </Avatar>
  );
};
