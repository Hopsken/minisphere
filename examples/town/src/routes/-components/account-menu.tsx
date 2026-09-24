import { Menu } from "@base-ui/react/menu";
import { ChevronDown, LogOut } from "lucide-react";

import type { Account } from "@/lib/account";

import { AccountAvatar } from "./account-avatar";

export const AccountMenu = ({
  account,
  pending,
  onLogout,
  onEditProfile,
}: {
  account: Account;
  pending: boolean;
  onLogout: () => void;
  onEditProfile: () => void;
}) => (
  <Menu.Root>
    <Menu.Trigger
      aria-label="Account menu"
      className="flex min-h-11 items-center gap-2 rounded-full p-1 text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
      disabled={pending}
    >
      <AccountAvatar
        name={account.name || account.handle}
        src={account.avatar}
      />
      <ChevronDown aria-hidden="true" className="size-4" />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner align="end" className="z-10" sideOffset={8}>
        <Menu.Popup className="w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-1 shadow-lg outline-none">
          <Menu.Item
            aria-label="Edit profile"
            className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 outline-none data-highlighted:bg-gray-100"
            onClick={onEditProfile}
          >
            <AccountAvatar
              name={account.name || account.handle}
              src={account.avatar}
            />
            <span className="min-w-0 text-sm">
              {account.name ? (
                <span className="block truncate font-semibold text-gray-950">
                  {account.name}
                </span>
              ) : null}
              <span className="block break-all text-gray-500">
                @{account.handle}
              </span>
            </span>
          </Menu.Item>
          <Menu.Separator className="mx-3 mb-1 h-px bg-gray-200" />
          <Menu.Item
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-gray-950 outline-none data-highlighted:bg-gray-100"
            onClick={onLogout}
          >
            <LogOut aria-hidden="true" className="size-4" />
            Log out
          </Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
);
