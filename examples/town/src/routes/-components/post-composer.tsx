import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { Account } from "@/lib/account";
import {
  canCreatePost,
  countGraphemes,
  getRecentPosts,
  PostPublisher,
  postValidationError,
} from "@/lib/posts";
import type { Post } from "@/lib/posts";

import { AccountAvatar } from "./account-avatar";
import { PostItem } from "./post-item";

export const PostComposer = ({
  account,
  authorize,
}: {
  account: Account;
  authorize: () => void;
}) => {
  const [publisher] = useState(
    () =>
      new PostPublisher(
        account.writer,
        account.reader,
        account.did,
        localStorage
      )
  );
  const draftKey = `town:draft:${account.did}`;
  const [text, setText] = useState(() =>
    publisher.pending?.confirmed
      ? ""
      : (publisher.pending?.record.text ?? localStorage.getItem(draftKey) ?? "")
  );
  const [posts, setPosts] = useState<Post[]>([]);
  const [message, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const readVersion = useRef(0);
  const writable = canCreatePost(account.agent.session.token.scope);
  const count = countGraphemes(text);
  const validation = postValidationError(text);

  const loadRecent = useCallback(async () => {
    readVersion.current += 1;
    const version = readVersion.current;
    setReadError(false);
    try {
      const recent = await getRecentPosts(account.reader, account.did);
      if (version === readVersion.current) {
        setPosts(recent);
      }
    } catch {
      if (version === readVersion.current) {
        setReadError(true);
      }
    }
  }, [account.reader, account.did]);

  useEffect(() => {
    void loadRecent();
    return () => {
      readVersion.current += 1;
    };
  }, [loadRecent]);

  const updateText = (value: string) => {
    setText(value);
    try {
      if (value) {
        localStorage.setItem(draftKey, value);
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {
      setError(
        "Browser storage is unavailable. Keep this page open to preserve your draft."
      );
    }
  };

  const run = async (readOnly: boolean) => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    readVersion.current += 1;
    setPending(true);
    setError(null);
    try {
      const post = readOnly
        ? await publisher.check()
        : await publisher.publish(text);
      if (post) {
        setPosts((current) =>
          [post, ...current.filter(({ uri }) => uri !== post.uri)].slice(0, 10)
        );
        updateText("");
        void loadRecent();
      } else {
        setError(
          "Post not found. Retry the same post below; no new record key will be created."
        );
      }
    } catch (error) {
      if (publisher.pending?.confirmed) {
        updateText("");
        setError(
          "Posted, but it could not be read back. Retry reading below; your post will not be sent again."
        );
      } else {
        setError(
          error instanceof Error
            ? error.message
            : "Request failed. Your draft is saved."
        );
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (writable) {
      void run(false);
    }
  };

  return (
    <>
      <form className="border-b border-gray-200 p-5 sm:p-6" onSubmit={submit}>
        <div className="flex gap-3">
          <AccountAvatar
            name={account.name || account.handle}
            src={account.avatar}
          />
          <div className="min-w-0 flex-1">
            <p className="mb-3 text-sm break-all text-gray-500">
              @{account.handle}
            </p>
            <textarea
              aria-label="Post text"
              aria-describedby="post-count"
              className="min-h-40 w-full resize-none text-lg leading-7 outline-none placeholder:text-gray-400 disabled:opacity-60"
              disabled={pending || !!publisher.pending}
              onChange={(event) => updateText(event.target.value)}
              placeholder="What's up?"
              value={text}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-4">
          <span
            className={
              count > 300 ? "text-sm text-red-700" : "text-sm text-gray-500"
            }
            id="post-count"
          >
            {count} / 300
          </span>
          <button
            className="post-button"
            disabled={
              pending || !!validation || !writable || !!publisher.pending
            }
            type="submit"
          >
            {pending ? "Working…" : "Post"}
          </button>
        </div>
        {text.trim() && validation ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {validation}
          </p>
        ) : null}
        {writable ? null : (
          <p className="mt-4 text-sm text-gray-600">
            This session cannot create posts.{" "}
            <button
              className="text-blue-600 underline"
              onClick={authorize}
              type="button"
            >
              Authorize posting
            </button>
          </p>
        )}
        {message ? (
          <p className="mt-4 text-sm text-red-700" role="alert">
            {message}
          </p>
        ) : null}
        {publisher.pending ? (
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <button
              className="text-blue-600 underline disabled:opacity-50"
              disabled={pending}
              onClick={() => {
                void run(true);
              }}
              type="button"
            >
              {publisher.pending.confirmed ? "Retry reading" : "Check post"}
            </button>
            {publisher.canRetry && !publisher.pending.confirmed && writable ? (
              <button
                className="text-blue-600 underline disabled:opacity-50"
                disabled={pending}
                onClick={() => {
                  void run(false);
                }}
                type="button"
              >
                Retry same post
              </button>
            ) : null}
          </div>
        ) : null}
      </form>
      {readError ? (
        <p className="p-6 text-sm text-red-700" role="alert">
          Could not load your recent posts.{" "}
          <button
            className="underline"
            onClick={() => {
              void loadRecent();
            }}
            type="button"
          >
            Retry reading
          </button>
        </p>
      ) : null}
      {posts.map((post) => (
        <PostItem account={account} key={post.uri} post={post} />
      ))}
    </>
  );
};
