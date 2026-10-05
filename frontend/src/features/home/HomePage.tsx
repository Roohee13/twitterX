import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { FOLLOWING_KEY, FOR_YOU_KEY } from '../../lib/feedCache'
import { useCursorQuery } from '../../lib/queries'
import type { PostResponse } from '../../lib/types'
import { PageHeader } from '../shell/PageHeader'
import { Composer } from '../compose/Composer'
import { usePostsCreated } from '../compose/ComposeContext'
import { PostCard, postKey } from '../posts/PostCard'

export const TIMELINE_KEY = FOLLOWING_KEY

type Tab = 'for-you' | 'following'
const TAB_STORAGE_KEY = 'xclone.homeTab'
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'for-you', label: 'For you' },
  { id: 'following', label: 'Following' },
]

/** For you unless the person last chose Following. */
function savedTab(): Tab {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === 'following' ? 'following' : 'for-you'
  } catch {
    return 'for-you'
  }
}

/** Home: "For you" (popular recent posts mixed with the people you follow, ranked by the server) and "Following" (only the people you follow, newest first). */
export function HomePage() {
  const queryClient = useQueryClient()
  const created = usePostsCreated()
  const [tab, setTab] = useState<Tab>(savedTab)
  // Only the tab on screen is loaded. Each feed stays fresh for a short while, then is refetched when the window regains focus.
  const forYou = useCursorQuery<PostResponse>(FOR_YOU_KEY, '/api/timeline/for-you', { staleTime: 30_000, enabled: tab === 'for-you' })
  const following = useCursorQuery<PostResponse>(FOLLOWING_KEY, '/api/timeline', { staleTime: 10_000, enabled: tab === 'following' })
  const feed = tab === 'for-you' ? forYou : following

  function choose(next: Tab) {
    setTab(next)
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next)
    } catch {
      /* the choice just does not outlive this page */
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const next = tab === 'for-you' ? 'following' : 'for-you'
    choose(next)
    document.getElementById(`home-tab-${next}`)?.focus()
  }

  function refresh() {
    window.scrollTo({ top: 0 })
    // Back to the first page only, instead of refetching every page that was scrolled through.
    void queryClient.resetQueries({ queryKey: tab === 'for-you' ? FOR_YOU_KEY : FOLLOWING_KEY })
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
          <RefreshCw size={18} className={feed.isRefetching ? 'animate-spin' : ''} />
        </button>
      </PageHeader>
      <div role="tablist" aria-label="Feed" onKeyDown={onKeyDown} className="flex border-b border-zinc-800">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            id={`home-tab-${id}`}
            role="tab"
            type="button"
            aria-selected={tab === id}
            aria-controls="home-feed"
            tabIndex={tab === id ? 0 : -1}
            onClick={() => choose(id)}
            className={`flex-1 py-4 font-semibold hover:bg-zinc-900 ${tab === id ? 'border-b-4 border-brand text-zinc-100' : 'text-zinc-500'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="border-b border-zinc-800 px-4 pt-3">
        <Composer onPosted={(posts) => created(posts)} />
      </div>
      <div id="home-feed" role="tabpanel" aria-labelledby={`home-tab-${tab}`}>
        {tab === 'for-you' ? (
          <InfiniteList
            query={forYou}
            getKey={postKey}
            renderItem={(post) => <PostCard post={post} />}
            emptyTitle="Nothing to show yet"
            emptyText="Popular posts and posts from people you follow will appear here. Write the first post, or follow some people."
          />
        ) : (
          <InfiniteList
            query={following}
            getKey={postKey}
            renderItem={(post) => <PostCard post={post} />}
            emptyTitle="Welcome to XClone"
            emptyText="Your timeline is empty. Follow people to see their posts here."
          />
        )}
      </div>
    </>
  )
}
