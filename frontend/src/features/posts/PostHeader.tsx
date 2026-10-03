import { Lock } from 'lucide-react'
import { Link } from 'react-router'
import { fullDate, timeAgo } from '../../lib/time'
import type { UserSummary } from '../../lib/types'

/** Name, lock icon for protected accounts, @handle and how long ago the post was made. */
export function PostHeader({ author, createdAt, postId }: { author: UserSummary; createdAt: string; postId?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-1 text-[15px]">
      <Link to={`/u/${author.username}`} className="truncate font-bold hover:underline">
        {author.displayName}
      </Link>
      {author.protectedAccount && <Lock size={14} aria-label="Protected account" className="shrink-0 text-zinc-400" />}
      <span className="truncate text-zinc-500">@{author.username}</span>
      <span aria-hidden="true" className="text-zinc-500">·</span>
      {postId === undefined ? (
        <time dateTime={createdAt} title={fullDate(createdAt)} className="shrink-0 text-zinc-500">{timeAgo(createdAt)}</time>
      ) : (
        <Link to={`/post/${postId}`} className="shrink-0 text-zinc-500 hover:underline" title={fullDate(createdAt)}>
          <time dateTime={createdAt}>{timeAgo(createdAt)}</time>
        </Link>
      )}
    </div>
  )
}
