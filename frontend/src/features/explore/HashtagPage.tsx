import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { useCursorQuery } from '../../lib/queries'
import type { PostResponse } from '../../lib/types'
import { PageHeader } from '../shell/PageHeader'
import { PostCard, postKey } from '../posts/PostCard'

/** Every post (and reply) using a hashtag, newest first. Posts from protected accounts you cannot see are left out by the server. */
export function HashtagPage() {
  const { name = '' } = useParams()
  const tag = name.toLowerCase()
  const posts = useCursorQuery<PostResponse>(['hashtag', tag], `/api/hashtags/${encodeURIComponent(tag)}/posts`)
  return (
    <>
      <PageHeader title={`#${tag}`}>
        <Link to="/explore" aria-label="Back to Explore" className="order-first -ml-2 rounded-full p-2 hover:bg-zinc-900"><ArrowLeft size={20} /></Link>
      </PageHeader>
      <InfiniteList
        query={posts}
        getKey={postKey}
        renderItem={(post) => <PostCard post={post} />}
        emptyTitle={`No posts with #${tag} yet`}
        emptyText="Be the first to post with it."
      />
    </>
  )
}
