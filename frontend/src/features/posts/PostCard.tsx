import { Repeat2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import type { PostResponse } from '../../lib/types'
import { PostActionBar } from './PostActionBar'
import { PostHeader } from './PostHeader'
import { PostMenu } from './PostMenu'
import { PostMedia } from './PostMedia'
import { PostText } from './PostText'

export function QuotedPost({ post }: { post: PostResponse }) {
  const navigate = useNavigate()
  return (
    <div
      className="mt-3 cursor-pointer rounded-2xl border border-zinc-800 p-3 hover:bg-hover"
      aria-label={`Quoted post by ${post.author.displayName}`}
      role="group"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return
        e.stopPropagation()
        navigate(`/post/${post.id}`)
      }}
    >
      <div className="mb-1 flex items-center gap-2">
        <Avatar src={post.author.avatarUrl} name={post.author.displayName} size="sm" className="!h-5 !w-5 !text-xs" />
        <div className="min-w-0 flex-1"><PostHeader author={post.author} createdAt={post.createdAt} /></div>
      </div>
      <PostText content={post.content} mentions={post.mentions} className="line-clamp-6 text-[15px]" />
      <PostMedia urls={post.mediaUrls} />
    </div>
  )
}

// Clicking anywhere on a card opens the post, except on the things that do their own job.
const INTERACTIVE = 'a, button, input, textarea, select, dialog, [role="menu"], [role="menuitem"]'

/** One post as shown in a feed. For a repost, `post` describes the original and `repostedBy` says who shared it. */
export function PostCard({ post }: { post: PostResponse }) {
  const navigate = useNavigate()
  return (
    <article
      aria-label={`Post by ${post.author.displayName}`}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest(INTERACTIVE) && !window.getSelection()?.toString()) navigate(`/post/${post.id}`)
      }}
      className="cursor-pointer border-b border-zinc-800 px-4 py-3 hover:bg-hover"
    >
      {post.repostedBy && (
        <p className="mb-1 flex gap-3 text-[13px] font-bold text-zinc-500">
          {/* The icon sits above the avatar and the text lines up with the post content below. */}
          <span className="flex w-10 shrink-0 justify-end"><Repeat2 size={14} aria-hidden="true" className="mt-0.5" /></span>
          <span>
            <Link to={`/u/${post.repostedBy.username}`} className="hover:underline">{post.repostedBy.displayName}</Link> reposted
          </span>
        </p>
      )}
      <div className="flex gap-3">
        {/* The name next to it is the accessible link to the same place, so this one stays out of the tab order. */}
        <Link to={`/u/${post.author.username}`} tabIndex={-1} aria-hidden="true" className="h-fit shrink-0"><Avatar src={post.author.avatarUrl} name={post.author.displayName} /></Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <PostHeader author={post.author} createdAt={post.createdAt} postId={post.id} />
            <PostMenu post={post} />
          </div>
          <PostText content={post.content} mentions={post.mentions} className="text-[15px]" />
          <PostMedia urls={post.mediaUrls} />
          {post.quotedPost && <QuotedPost post={post.quotedPost} />}
          <PostActionBar post={post} />
        </div>
      </div>
    </article>
  )
}

/** Two rows can show the same original post (reposted by different people), so the id alone is not a unique key. */
export const postKey = (post: PostResponse) => `${post.id}-${post.repostedBy?.id ?? 'own'}`
