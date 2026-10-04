import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { useCursorQuery } from '../../lib/queries'
import type { PostResponse } from '../../lib/types'
import { PageHeader } from '../shell/PageHeader'
import { Composer } from '../compose/Composer'
import { usePostsCreated } from '../compose/ComposeContext'
import { PostCard, postKey } from '../posts/PostCard'

export const TIMELINE_KEY = ['timeline']

export function HomePage() {
  const queryClient = useQueryClient()
  const created = usePostsCreated()
  // Fresh for 10 seconds; after that it is refetched whenever the tab regains focus.
  const timeline = useCursorQuery<PostResponse>(TIMELINE_KEY, '/api/timeline', { staleTime: 10_000 })

  function refresh() {
    window.scrollTo({ top: 0 })
    // Back to the first page only, instead of refetching every page that was scrolled through.
    void queryClient.resetQueries({ queryKey: TIMELINE_KEY })
  }

  return (
    <>
      <PageHeader title="Home">
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh timeline"
          title="Refresh"
          className="ml-auto rounded-full p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
        >
          <RefreshCw size={18} className={timeline.isRefetching ? 'animate-spin' : ''} />
        </button>
      </PageHeader>
      <div className="border-b border-zinc-800 px-4 pt-3">
        <Composer onPosted={(posts) => created(posts)} />
      </div>
      <InfiniteList
        query={timeline}
        getKey={postKey}
        renderItem={(post) => <PostCard post={post} />}
        emptyTitle="Welcome to XClone"
        emptyText="Your timeline is empty. Follow people to see their posts here."
      />
    </>
  )
}
