import { useQuery } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { Spinner } from '../../components/ui/Spinner'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { api } from '../../lib/api'
import { useCursorQuery } from '../../lib/queries'
import type { PostResponse, TrendingHashtag, UserSummary } from '../../lib/types'
import { useDebounced } from '../../lib/useDebounced'
import { usePageTitle } from '../../lib/usePageTitle'
import { PostCard, postKey } from '../posts/PostCard'
import { UserRow } from '../profile/FollowListPage'
import { WhoToFollow } from './WhoToFollow'

const MIN_POST_SEARCH = 2 // the server refuses shorter post searches
const MAX_QUERY = 100

type Tab = 'posts' | 'people'

function TrendingList() {
  const trends = useQuery({ queryKey: ['trending', 'full'], queryFn: ({ signal }) => api.get<TrendingHashtag[]>('/api/trending/hashtags?limit=20', { signal }), staleTime: 60_000 })
  return (
    <section aria-label="Trending">
      <h2 className="px-4 py-3 text-xl font-extrabold">Trending</h2>
      {trends.isPending && <Spinner />}
      {trends.isError && <ErrorState message="Trends are unavailable right now." onRetry={() => void trends.refetch()} />}
      {trends.data?.length === 0 && <p className="px-4 pb-4 text-zinc-500">Nothing is trending yet. Post with a #hashtag to start something.</p>}
      {trends.data?.map((tag) => (
        <Link key={tag.name} to={`/hashtag/${tag.name}`} className="block border-b border-zinc-800 px-4 py-3 hover:bg-white/[0.03]">
          <p className="font-bold">#{tag.name}</p>
          <p className="text-sm text-zinc-500">{tag.postCount} {tag.postCount === 1 ? 'post' : 'posts'} · {tag.userCount} {tag.userCount === 1 ? 'person' : 'people'}</p>
        </Link>
      ))}
    </section>
  )
}

function PostResults({ q }: { q: string }) {
  const enabled = q.length >= MIN_POST_SEARCH
  const results = useCursorQuery<PostResponse>(['search', 'posts', q], '/api/posts/search', { enabled, params: { q } })
  if (!enabled) return <EmptyState title="Keep typing">Post search needs at least {MIN_POST_SEARCH} characters.</EmptyState>
  return <InfiniteList query={results} getKey={postKey} renderItem={(post) => <PostCard post={post} />} emptyTitle={`No posts match “${q}”`} emptyText="Try different words, or search for people." />
}

function PeopleResults({ q }: { q: string }) {
  const people = useQuery({ queryKey: ['search', 'people', q], queryFn: ({ signal }) => api.get<UserSummary[]>(`/api/users/search?q=${encodeURIComponent(q)}`, { signal }) })
  if (people.isPending) return <Spinner />
  if (people.isError) return <ErrorState message={people.error.message} onRetry={() => void people.refetch()} />
  if (people.data.length === 0) return <EmptyState title={`No people match “${q}”`}>Names and @usernames are matched from the start.</EmptyState>
  return <div>{people.data.map((user) => <UserRow key={user.id} user={user} />)}</div>
}

/** Search for posts and people, or browse what is trending and who to follow. The search lives in the address (?q=…&tab=…). */
export function ExplorePage() {
  const [params, setParams] = useSearchParams()
  const typed = params.get('q') ?? ''
  const q = useDebounced(typed.trim(), 300) // what is actually searched; the box itself updates at once
  usePageTitle(q ? `Search: ${q}` : 'Explore')
  const chosen = params.get('tab')
  const tab: Tab = chosen === 'posts' || chosen === 'people' ? chosen : typed.trim().startsWith('@') ? 'people' : 'posts'

  const update = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    change(next)
    setParams(next, { replace: true })
  }
  const setQuery = (value: string) => update((next) => (value ? next.set('q', value) : next.delete('q')))

  return (
    <>
      <h1 className="sr-only">Explore</h1>
      <div className="sticky top-0 z-10 border-b border-zinc-800 bg-black/80 px-4 py-2 backdrop-blur">
        <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
          <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            aria-label="Search"
            placeholder="Search"
            maxLength={MAX_QUERY}
            autoFocus={!typed}
            value={typed}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-full bg-zinc-900 py-2.5 pl-11 pr-10 text-[15px] placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand [&::-webkit-search-cancel-button]:hidden"
          />
          {typed && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-brand p-1 text-white">
              <X size={12} />
            </button>
          )}
        </form>
      </div>

      {q === '' ? (
        <>
          <TrendingList />
          <div className="p-4"><WhoToFollow limit={10} /></div>
        </>
      ) : (
        <>
          <div role="tablist" aria-label="Search results" className="flex border-b border-zinc-800">
            {(['posts', 'people'] as const).map((id) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => update((next) => next.set('tab', id))}
                className={`flex-1 py-4 font-semibold capitalize hover:bg-zinc-900 ${tab === id ? 'border-b-4 border-brand text-white' : 'text-zinc-500'}`}
              >
                {id}
              </button>
            ))}
          </div>
          {tab === 'posts' ? <PostResults q={q} /> : <PeopleResults q={q} />}
        </>
      )}
    </>
  )
}
