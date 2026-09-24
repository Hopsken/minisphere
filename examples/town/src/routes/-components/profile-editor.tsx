import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useRef, useState } from "react";

import type { Account } from "@/lib/account";
import { readProfile } from "@/lib/profile";
import type { ProfileSnapshot } from "@/lib/profile";

import { ProfileForm } from "./profile-form";

export const ProfileEditor = ({
  account,
  onClose,
  onSaved,
}: {
  account: Account;
  onClose: () => void;
  onSaved: (profile: ProfileSnapshot["record"]) => void;
}) => {
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const saving = useRef(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = await readProfile(account.reader, account.did);
        if (active) {
          setSnapshot(value);
        }
      } catch {
        if (active) {
          setFailed(true);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [account.reader, account.did, revision]);

  const reload = () => {
    setSnapshot(null);
    setFailed(false);
    setRevision((value) => value + 1);
  };

  return (
    <Dialog.Root
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !saving.current) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-20 bg-black/45" />
        <Dialog.Popup
          className="fixed top-1/2 left-1/2 z-30 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-xl outline-none"
          finalFocus={() =>
            document.querySelector<HTMLButtonElement>(
              '[aria-label="Account menu"]'
            )
          }
        >
          {snapshot ? (
            <ProfileForm
              account={account}
              snapshot={snapshot}
              onSaved={onSaved}
              onPending={(pending) => {
                saving.current = pending;
              }}
              onReload={reload}
            />
          ) : (
            <div className="p-6">
              <div className="mb-5 flex items-center justify-between">
                <Dialog.Title className="font-semibold">
                  Edit profile
                </Dialog.Title>
                <Dialog.Close className="min-h-11 px-2 text-sm text-gray-600">
                  Cancel
                </Dialog.Close>
              </div>
              <Dialog.Description className="text-sm text-gray-600">
                {failed ? "Could not load your profile." : "Loading profile…"}
              </Dialog.Description>
              {failed ? (
                <button
                  className="mt-3 min-h-11 text-sm text-blue-600 underline"
                  type="button"
                  onClick={reload}
                >
                  Retry
                </button>
              ) : null}
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
