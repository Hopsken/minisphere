import { AppBskyActorProfile } from "@atcute/bluesky";
import { safeParse } from "@atcute/lexicons";
import { Dialog } from "@base-ui/react/dialog";
import { Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { getAvatarUrl } from "@/lib/account";
import type { Account } from "@/lib/account";
import { putProfile, uploadAvatar } from "@/lib/profile";
import type { ProfileSnapshot } from "@/lib/profile";

const ProfileFeedback = ({
  checkingImage,
  changed,
  valid,
  message,
  needsReload,
  onReload,
}: {
  checkingImage: boolean;
  changed: boolean;
  valid: boolean;
  message: string | null;
  needsReload: boolean;
  onReload: () => void;
}) => (
  <>
    {checkingImage ? (
      <p className="text-sm text-gray-500" role="status">
        Checking image…
      </p>
    ) : null}
    {changed && !valid ? (
      <p className="text-sm text-red-700" role="alert">
        Use up to 64 characters for your name and 256 for your description.
      </p>
    ) : null}
    {message ? (
      <p className="text-sm text-red-700" role="alert">
        {message}
      </p>
    ) : null}
    {needsReload ? (
      <button
        className="min-h-11 text-sm text-blue-600 underline"
        type="button"
        onClick={onReload}
      >
        Reload profile
      </button>
    ) : null}
  </>
);

export const ProfileForm = ({
  account,
  snapshot,
  onSaved,
  onPending,
  onReload,
}: {
  account: Account;
  snapshot: ProfileSnapshot;
  onSaved: (profile: ProfileSnapshot["record"]) => void;
  onPending: (pending: boolean) => void;
  onReload: () => void;
}) => {
  const [displayName, setDisplayName] = useState(
    snapshot.record.displayName ?? ""
  );
  const [description, setDescription] = useState(
    snapshot.record.description ?? ""
  );
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>();
  const [saveError, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checkingImage, setCheckingImage] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const busy = useRef(false);
  const imageVersion = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    },
    [preview]
  );

  const selectImage = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    imageVersion.current += 1;
    const version = imageVersion.current;
    setImage(null);
    setPreview(undefined);
    setCheckingImage(false);
    setImageError(null);
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      file.size > 1_000_000
    ) {
      setImageError("Choose a JPEG or PNG image up to 1 MB.");
      return;
    }
    setCheckingImage(true);
    try {
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      if (version === imageVersion.current) {
        setImage(file);
        setPreview(URL.createObjectURL(file));
      }
    } catch {
      if (version === imageVersion.current) {
        setImageError("This image could not be opened. Choose another image.");
      }
    } finally {
      if (version === imageVersion.current) {
        setCheckingImage(false);
      }
    }
  };

  const record = {
    ...snapshot.record,
    $type: "app.bsky.actor.profile" as const,
    description,
    displayName,
  };
  const valid = safeParse(AppBskyActorProfile.mainSchema, record, {
    strict: true,
  }).ok;
  const changed =
    displayName !== (snapshot.record.displayName ?? "") ||
    description !== (snapshot.record.description ?? "") ||
    !!image;
  const { avatar } = snapshot.record;
  const avatarUrl =
    preview ??
    (avatar
      ? getAvatarUrl(account.service, account.did, avatar.ref.$link)
      : undefined);

  const canSave =
    !pending &&
    changed &&
    valid &&
    !checkingImage &&
    !imageError &&
    !needsReload;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || !canSave) {
      return;
    }
    busy.current = true;
    onPending(true);
    setPending(true);
    setError(null);
    let writing = false;
    try {
      const next = image
        ? { ...record, avatar: await uploadAvatar(account.writer, image) }
        : record;
      writing = true;
      await putProfile(account.writer, account.did, snapshot, next);
      onSaved(next);
    } catch (error) {
      setNeedsReload(writing);
      let message = "Could not upload the image. Try again.";
      if (writing) {
        message =
          "The save result is unknown. Reload your profile before trying again.";
        if (
          error instanceof Error &&
          error.name !== "TimeoutError" &&
          error.name !== "TypeError"
        ) {
          ({ message } = error);
        }
      }
      setError(message);
    } finally {
      busy.current = false;
      onPending(false);
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        void save(event);
      }}
    >
      <header className="sticky top-0 z-10 grid h-16 grid-cols-[1fr_auto_1fr] items-center border-b border-gray-200 bg-white px-4">
        <Dialog.Close
          className="min-h-11 justify-self-start rounded-lg px-2 text-sm text-gray-600 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50"
          disabled={pending}
        >
          Cancel
        </Dialog.Close>
        <Dialog.Title className="font-semibold">Edit profile</Dialog.Title>
        <button
          className="min-h-11 justify-self-end rounded-lg px-2 text-sm font-semibold text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:text-gray-400"
          type="submit"
          disabled={!canSave}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </header>
      <div className="space-y-5 p-5 sm:p-6">
        <Dialog.Description className="sr-only">
          Edit your public Bluesky profile.
        </Dialog.Description>
        <div className="flex flex-col items-center gap-3 py-2">
          <button
            aria-label="Choose avatar"
            className="relative size-24 rounded-full bg-blue-100 text-3xl font-semibold text-blue-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 disabled:opacity-50"
            disabled={pending || checkingImage}
            onClick={() => input.current?.click()}
            type="button"
          >
            {avatarUrl ? (
              <img
                alt="Profile preview"
                className="size-full rounded-full object-cover"
                src={avatarUrl}
              />
            ) : (
              (displayName || account.handle).slice(0, 1).toUpperCase()
            )}
            <span className="absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full border border-gray-200 bg-white">
              <Camera aria-hidden="true" className="size-4 text-gray-700" />
            </span>
          </button>
          <input
            accept="image/jpeg,image/png"
            className="hidden"
            id="profile-avatar"
            ref={input}
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void selectImage(file);
            }}
          />
          <p className="text-xs text-gray-500">JPEG or PNG · Up to 1 MB</p>
        </div>
        <div>
          <label
            className="mb-2 block text-sm font-medium text-gray-700"
            htmlFor="profile-name"
          >
            Display name
          </label>
          <input
            autoComplete="nickname"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
            disabled={pending}
            id="profile-name"
            onChange={(event) => setDisplayName(event.target.value)}
            value={displayName}
          />
        </div>
        <div>
          <label
            className="mb-2 block text-sm font-medium text-gray-700"
            htmlFor="profile-description"
          >
            Description
          </label>
          <textarea
            className="min-h-28 w-full resize-y rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
            disabled={pending}
            id="profile-description"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Tell us about yourself"
            value={description}
          />
        </div>
        <ProfileFeedback
          checkingImage={checkingImage}
          changed={changed}
          valid={valid}
          message={imageError || saveError}
          needsReload={needsReload}
          onReload={onReload}
        />
      </div>
    </form>
  );
};
