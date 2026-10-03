import { Heart, MessageCircle, Repeat2 } from 'lucide-react'
import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import type { PostResponse } from '../../lib/types'
import { PostHeader } from './PostHeader'
import { PostMedia } from './PostMedia'
import { PostText } from './PostText'

function Stat({ icon, count, one, many }: { icon: React.ReactNode; count: number; one: string; many: string }) {
  return (
    <span aria-label={`${count} ${count === 1 ? one : many}`} className="flex min-w-14 items-center gap-1.5 text-sm text-zinc-500">
      {icon}
      {count > 0 && <span aria-hidden="true">{count}</span>}
    </span>
  )
}

function QuotedPost({ post }: { post: PostResponse }) {
  return (
    <div className="mt-3 rounded-2xl border border-zinc-800 p-3" aria-label={`Quoted post by ${post.author.displayName}`} role="group">
      <div className="mb-1 flex items-center gap-2">
        <Avatar src={post.author.avatarUrl} name={post.author.displayName} size="sm" className="!h-5 !w-5 !text-xs" />
        <div className="min-w-0 flex-1"><PostHeader author={post.author} createdAt={post.createdAt} /></div>
      </div>
      <PostText content={post.content} mentions={post.mentions} className="line-clamp-6 text-[15px]" />
      <PostMedia urls={post.mediaUrls} />
    </div>
  )
}

/** One post as shown in a feed. For a repost, `post` describes the original and `repostedBy` says who shared it. */
export function PostCard({ post }: { post: PostResponse }) {
  return (
    <article aria-label={`Post by ${post.author.displayName}`} className="border-b border-zinc-800 px-4 py-3 hover:bg-white/[0.02]">
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
        <Avatar src={post.author.avatarUrl} name={post.author.displayName} />
        <div className="min-w-0 flex-1">
          <PostHeader author={post.author} createdAt={post.createdAt} />
          <PostText content={post.content} mentions={post.mentions} className="text-[15px]" />
          <PostMedia urls={post.mediaUrls} />
          {post.quotedPost && <QuotedPost post={post.quotedPost} />}
          <div className="mt-2 -ml-2 flex" role="group" aria-label="Post statistics">
            <Stat icon={<MessageCircle size={18} />} count={post.replyCount} one="reply" many="replies" />
            <Stat icon={<Repeat2 size={18} />} count={post.repostCount} one="repost" many="reposts" />
            <Stat icon={<Heart size={18} />} count={post.likeCount} one="like" many="likes" />
          </div>
        </div>
      </div>
    </article>
  )
}

/** Two rows can show the same original post (reposted by different people), so the id alone is not a unique key. */
export const postKey = (post: PostResponse) => `${post.id}-${post.repostedBy?.id ?? 'own'}`
