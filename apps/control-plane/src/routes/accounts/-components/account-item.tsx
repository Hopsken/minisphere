import { Blobatar } from "blobatar/react";

import type { ManagedAccount } from "~/schema/managed-account";

export const AccountItem = ({ account }: { account: ManagedAccount }) => (
  <div className="group flex min-w-0 flex-col items-center gap-3">
    <Blobatar
      name={account.did}
      className="size-20 shadow-sm transition-shadow group-hover:shadow-md sm:size-24"
    />
    {/*<span className="w-full truncate px-1 text-center text-sm font-medium">
        {name}
      </span>*/}
  </div>
);
