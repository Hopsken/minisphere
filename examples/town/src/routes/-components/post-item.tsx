import type { Account } from "@/lib/account";
import type { Post } from "@/lib/posts";

import { AccountAvatar } from "./account-avatar";

export const PostItem = ({
  account,
  post,
}: {
  account: Account;
  post: Post;
}) => (
  <article className="flex gap-3 border-b border-gray-200 p-5 sm:p-6">
    <AccountAvatar name={account.name || account.handle} src={account.avatar} />
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold">
          {account.name || account.handle.split(".")[0]}
        </span>
        <span className="text-sm break-all text-gray-500">
          @{account.handle}
        </span>
        <time
          className="text-xs text-gray-500"
          dateTime={post.record.createdAt}
        >
          {new Date(post.record.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </time>
      </div>
      <p className="mt-1 leading-6 break-words whitespace-pre-wrap">
        {post.record.text}
      </p>
    </div>
  </article>
);
