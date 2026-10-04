import { InfiniteList } from '../../components/ui/InfiniteList'
import { useCursorQuery } from '../../lib/queries'
import type { PostResponse } from '../../lib/types'
import { PageHeader } from '../shell/PageHeader'
import { PostCard, postKey } from '../posts/PostCard'

export const BOOKMARKS_KEY = ['bookmarks']

/** Posts you saved, most recently saved first. Un-bookmarking a post takes it off the list straight away. */
export function BookmarksPage() {
  const bookmarks = useCursorQuery<PostResponse>(BOOKMARKS_KEY, '/api/bookmarks', { staleTime: 5_000 })
  return (
    <>
      <PageHeader title="Bookmarks" />
      <InfiniteList
        query={bookmarks}
        getKey={postKey}
        // Only drop posts the server says are no longer bookmarked; a server that does not send the flag at all (an older
        // backend) must not make the whole list disappear.
        filter={(post) => post.bookmarkedByMe !== false}
        renderItem={(post) => <PostCard post={post} />}
        emptyTitle="Save posts for later"
        emptyText="Use the bookmark button on any post to find it here."
      />
    </>
  )
}
