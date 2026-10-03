import type { QueryClient } from '@tanstack/react-query'
import type { CursorPage, PostResponse } from './types'

// Posts live in many cached lists at once (timeline, profile tabs, replies, a post's own page, quoted inside other posts).
// These helpers update or remove one post everywhere, so a like or an edit shows up on every screen without refetching.

function isPost(value: unknown): value is PostResponse {
  const v = value as Partial<PostResponse> | null
  return typeof v === 'object' && v !== null && typeof v.id === 'number' && typeof v.content === 'string' && 'author' in v && 'likeCount' in v
}

type Patch = (post: PostResponse) => PostResponse

/** Applies `fn` to every post with this id, including copies embedded as quoted posts. Returns the same object when nothing changed. */
function mapDeep(data: unknown, id: number, fn: Patch): unknown {
  if (Array.isArray(data)) {
    const next = data.map((item) => mapDeep(item, id, fn))
    return next.some((item, i) => item !== data[i]) ? next : data
  }
  if (isPost(data)) {
    let post: PostResponse = data
    if (post.id === id) post = fn(post)
    if (post.quotedPost) {
      const quoted = mapDeep(post.quotedPost, id, fn) as PostResponse
      if (quoted !== post.quotedPost) post = { ...post, quotedPost: quoted }
    }
    return post
  }
  if (data && typeof data === 'object' && 'pages' in data && Array.isArray((data as { pages: unknown }).pages)) {
    const infinite = data as { pages: Array<CursorPage<PostResponse>> }
    const pages = infinite.pages.map((page) => {
      const items = mapDeep(page.items, id, fn) as PostResponse[]
      return items === page.items ? page : { ...page, items }
    })
    return pages.some((page, i) => page !== infinite.pages[i]) ? { ...infinite, pages } : data
  }
  return data
}

export function patchPost(queryClient: QueryClient, id: number, fn: Patch) {
  queryClient.setQueriesData({}, (old: unknown) => (old === undefined ? old : mapDeep(old, id, fn)))
}

function removeDeep(data: unknown, id: number): unknown {
  if (Array.isArray(data)) {
    const kept = data.filter((item) => !(isPost(item) && item.id === id)).map((item) => removeDeep(item, id))
    return kept.length === data.length && kept.every((item, i) => item === data[i]) ? data : kept
  }
  if (data && typeof data === 'object' && 'pages' in data && Array.isArray((data as { pages: unknown }).pages)) {
    const infinite = data as { pages: Array<CursorPage<PostResponse>> }
    const pages = infinite.pages.map((page) => {
      const items = removeDeep(page.items, id) as PostResponse[]
      return items === page.items ? page : { ...page, items }
    })
    return pages.some((page, i) => page !== infinite.pages[i]) ? { ...infinite, pages } : data
  }
  return data
}

/** Takes a deleted post out of every cached list (reposts of it too, since they share its id). */
export function removePost(queryClient: QueryClient, id: number) {
  queryClient.setQueriesData({}, (old: unknown) => (old === undefined ? old : removeDeep(old, id)))
  queryClient.removeQueries({ queryKey: ['post', id] })
}

/** Puts new top-level posts at the top of the loaded home timeline (newest first); nothing happens if it is not loaded. */
export function prependToTimeline(queryClient: QueryClient, posts: PostResponse[]) {
  queryClient.setQueryData<{ pages: Array<CursorPage<PostResponse>>; pageParams: unknown[] }>(['timeline'], (old) => {
    if (!old || old.pages.length === 0) return old
    const [first, ...rest] = old.pages
    const fresh = [...posts].reverse().filter((p) => !first.items.some((existing) => existing.id === p.id && !existing.repostedBy))
    return { ...old, pages: [{ ...first, items: [...fresh, ...first.items] }, ...rest] }
  })
}
