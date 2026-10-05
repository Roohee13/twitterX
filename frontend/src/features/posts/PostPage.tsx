import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { Spinner } from '../../components/ui/Spinner'
import { EmptyState } from '../../components/ui/States'
import { ApiError, api } from '../../lib/api'
import { useCursorQuery } from '../../lib/queries'
import { fullDate } from '../../lib/time'
import type { PostResponse } from '../../lib/types'
import { Composer } from '../compose/Composer'
import { usePostsCreated } from '../compose/ComposeContext'
import { PageHeader } from '../shell/PageHeader'
import { LikersDialog } from './LikersDialog'
import { RepostersDialog } from './RepostersDialog'
import { PostActionBar } from './PostActionBar'
import { PostCard, postKey, QuotedPost } from './PostCard'
import { PostMenuThatLeavesOnDelete } from './PostMenu'
import { PostMedia } from './PostMedia'
import { PostText } from './PostText'

const retryUnlessClientError = (failures: number, error: Error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2

function usePost(id: number | null) {
  return useQuery({
    queryKey: ['post', id],
    queryFn: ({ signal }) => api.get<PostResponse>(`/api/posts/${id}`, { signal }),
    enabled: id !== null,
    retry: retryUnlessClientError,
  })
}

/** Why a post cannot be shown: gone, protected, or hidden by a block. */
function Unavailable({ error }: { error: unknown }) {
  const status = error instanceof ApiError ? error.status : 0
  const message = error instanceof ApiError ? error.message : ''
  let title = 'Something went wrong'
  let text = 'Try again in a moment.'
  if (status === 404) {
    title = "This post doesn't exist"
    text = 'It may have been deleted.'
  } else if (status === 403 && /protected/i.test(message)) {
    title = 'These posts are protected'
    text = 'Only people the author has approved can see them.'
  } else if (status === 403) {
    title = "You can't view this post"
    text = message
  }
  return (
    <div role="alert">
      <EmptyState title={title}>{text}</EmptyState>
      <p className="pb-8 text-center"><Link to="/" className="font-semibold text-brand hover:underline">Go home</Link></p>
    </div>
  )
}

/** The reply box, or the reason there isn't one. */
function ReplyArea({ post }: { post: PostResponse }) {
  const created = usePostsCreated()
  if (post.canReply) {
    return (
      <div className="border-b border-zinc-800 px-4 pt-3">
        <Composer replyTo={post} showReplyContext={false} submitLabel="Post reply" placeholder="Post your reply" onPosted={(posts) => created(posts, { replyTo: post })} />
      </div>
    )
  }
  const detail = post.replyPolicy === 'MENTIONED' ? 'Only accounts mentioned in this conversation can reply.' : 'Only accounts the author follows can reply.'
  return (
    <p role="status" className="border-b border-zinc-800 px-4 py-4 text-sm text-zinc-400">
      <span className="font-semibold text-zinc-200">The author limits who can reply to this conversation.</span> {detail}
    </p>
  )
}

function FocusedPost({ post }: { post: PostResponse }) {
  const [showLikers, setShowLikers] = useState(false)
  const [showReposters, setShowReposters] = useState(false)
  return (
    <article aria-label={`Post by ${post.author.displayName}`} className="border-b border-zinc-800 px-4 pt-3">
      <div className="flex items-center gap-3">
        <Avatar src={post.author.avatarUrl} name={post.author.displayName} />
        <div className="min-w-0 flex-1">
          <Link to={`/u/${post.author.username}`} className="block truncate font-bold hover:underline">{post.author.displayName}</Link>
          <span className="block truncate text-zinc-500">@{post.author.username}</span>
        </div>
        <PostMenuThatLeavesOnDelete post={post} />
      </div>
      <PostText content={post.content} mentions={post.mentions} className="mt-3 text-xl" />
      <PostMedia urls={post.mediaUrls} />
      {post.quotedPost && <QuotedPost post={post.quotedPost} />}
      <p className="mt-3 text-[15px] text-zinc-500"><time dateTime={post.createdAt}>{fullDate(post.createdAt)}</time></p>
      <div className="mt-3 flex gap-5 border-y border-zinc-800 py-3 text-[15px]" aria-label="Post statistics" role="group">
        {post.repostCount > 0 ? (
          <button type="button" onClick={() => setShowReposters(true)} className="hover:underline"><strong>{post.repostCount}</strong> <span className="text-zinc-500">{post.repostCount === 1 ? 'Repost' : 'Reposts'}</span></button>
        ) : (
          <span><strong>0</strong> <span className="text-zinc-500">Reposts</span></span>
        )}
        {post.likeCount > 0 ? (
          <button type="button" onClick={() => setShowLikers(true)} className="hover:underline"><strong>{post.likeCount}</strong> <span className="text-zinc-500">{post.likeCount === 1 ? 'Like' : 'Likes'}</span></button>
        ) : (
          <span><strong>0</strong> <span className="text-zinc-500">Likes</span></span>
        )}
        <span><strong>{post.replyCount}</strong> <span className="text-zinc-500">{post.replyCount === 1 ? 'Reply' : 'Replies'}</span></span>
      </div>
      <div className="flex justify-around py-1"><PostActionBar post={post} /></div>
      {showReposters && <RepostersDialog postId={post.id} onClose={() => setShowReposters(false)} />}
      {showLikers && <LikersDialog postId={post.id} onClose={() => setShowLikers(false)} />}
    </article>
  )
}

/** The post this one answers, shown above it. A parent that cannot be shown becomes a short placeholder. */
function ParentContext({ parentId }: { parentId: number }) {
  const parent = usePost(parentId)
  if (parent.isPending) return <Spinner label="Loading the post this replies to" />
  if (parent.isError) return <p className="border-b border-zinc-800 px-4 py-3 text-sm text-zinc-500">The post this replies to is unavailable.</p>
  return <PostCard post={parent.data} />
}

export function PostPage() {
  const params = useParams()
  const navigate = useNavigate()
  const parsed = Number(params.id)
  const postId = Number.isInteger(parsed) && parsed > 0 ? parsed : null
  const post = usePost(postId)
  const replies = useCursorQuery<PostResponse>(['replies', postId], `/api/posts/${postId}/replies`, { enabled: post.isSuccess })

  // For a top-level post: the author's own follow-ups (their thread). They are shown right under the post, so the
  // replies list below leaves them out instead of showing them twice.
  const isTopLevel = post.data?.replyToId === null
  const thread = useQuery({
    queryKey: ['thread', postId],
    queryFn: ({ signal }) => api.get<PostResponse[]>(`/api/posts/${postId}/thread`, { signal }),
    enabled: post.isSuccess && isTopLevel,
    retry: retryUnlessClientError,
  })
  const continuation = useMemo(() => thread.data?.filter((p) => p.id !== postId) ?? [], [thread.data, postId])
  const inThread = useMemo(() => new Set(continuation.map((p) => p.id)), [continuation])

  return (
    <>
      <PageHeader title="Post">
        <button type="button" aria-label="Back" onClick={() => navigate(-1)} className="order-first -ml-2 rounded-full p-2 hover:bg-zinc-900">
          <ArrowLeft size={20} />
        </button>
      </PageHeader>

      {postId === null && <Unavailable error={new ApiError(404, 'Not found')} />}
      {post.isPending && postId !== null && <Spinner />}
      {post.isError && <Unavailable error={post.error} />}
      {post.isSuccess && (
        <>
          {post.data.replyToId !== null && <ParentContext parentId={post.data.replyToId} />}
          <FocusedPost post={post.data} />
          <ReplyArea post={post.data} />
          {continuation.length > 0 && (
            <section aria-label="More from the author">
              {continuation.map((p) => <PostCard key={p.id} post={p} />)}
            </section>
          )}
          <InfiniteList
            query={replies}
            getKey={postKey}
            filter={(reply) => !inThread.has(reply.id)}
            renderItem={(reply) => <PostCard post={reply} />}
            emptyTitle="No replies yet"
            emptyText={post.data.canReply ? 'Be the first to reply.' : undefined}
          />
        </>
      )}
    </>
  )
}
