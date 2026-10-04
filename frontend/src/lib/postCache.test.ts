import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { makePost, makeUser } from '../test/fixtures'
import { patchPost, prependToTimeline, removePost } from './postCache'
import type { PostResponse } from './types'

const infinite = (...items: PostResponse[]) => ({ pages: [{ items, nextCursor: null }], pageParams: [null] })

describe('post cache helpers', () => {
  it('updates one post in every list that holds it, including repost rows and quoted copies', () => {
    const qc = new QueryClient()
    const target = makePost({ id: 1, likeCount: 2 })
    const repostRow = { ...target, repostedBy: makeUser({ id: 5 }) }
    const quoting = makePost({ id: 2, quotedPost: target })
    qc.setQueryData(['timeline'], infinite(target, makePost({ id: 3 })))
    qc.setQueryData(['profile', 'posts'], infinite(repostRow, quoting))
    qc.setQueryData(['post', 1], target)
    qc.setQueryData(['thread', 1], [target])

    patchPost(qc, 1, (p) => ({ ...p, likeCount: 3, likedByMe: true }))

    expect(qc.getQueryData<ReturnType<typeof infinite>>(['timeline'])!.pages[0].items[0]).toMatchObject({ likeCount: 3, likedByMe: true })
    const profile = qc.getQueryData<ReturnType<typeof infinite>>(['profile', 'posts'])!.pages[0].items
    expect(profile[0]).toMatchObject({ likeCount: 3, repostedBy: { id: 5 } })
    expect(profile[1].quotedPost).toMatchObject({ id: 1, likeCount: 3 })
    expect(qc.getQueryData<PostResponse>(['post', 1])).toMatchObject({ likedByMe: true })
    expect(qc.getQueryData<PostResponse[]>(['thread', 1])![0]).toMatchObject({ likeCount: 3 })
  })

  it('leaves unrelated posts and other kinds of cached data untouched (same object, no re-render)', () => {
    const qc = new QueryClient()
    const timeline = infinite(makePost({ id: 10 }))
    const trends = [{ name: 'java', postCount: 1, userCount: 1 }]
    qc.setQueryData(['timeline'], timeline)
    qc.setQueryData(['trending'], trends)

    patchPost(qc, 999, (p) => ({ ...p, likeCount: 50 }))

    expect(qc.getQueryData(['timeline'])).toBe(timeline)
    expect(qc.getQueryData(['trending'])).toBe(trends)
  })

  it('removes a deleted post from lists and from the single-post cache', () => {
    const qc = new QueryClient()
    qc.setQueryData(['timeline'], infinite(makePost({ id: 1 }), makePost({ id: 2 })))
    qc.setQueryData(['post', 1], makePost({ id: 1 }))

    removePost(qc, 1)

    expect(qc.getQueryData<ReturnType<typeof infinite>>(['timeline'])!.pages[0].items.map((p) => p.id)).toEqual([2])
    expect(qc.getQueryData(['post', 1])).toBeUndefined()
  })

  it('puts new posts at the top of a loaded timeline, newest first, without duplicating', () => {
    const qc = new QueryClient()
    qc.setQueryData(['timeline'], infinite(makePost({ id: 1 })))
    const first = makePost({ id: 2 })
    const second = makePost({ id: 3 })

    prependToTimeline(qc, [first, second]) // a thread: first post, then the follow-up
    prependToTimeline(qc, [first]) // already there

    expect(qc.getQueryData<ReturnType<typeof infinite>>(['timeline'])!.pages[0].items.map((p) => p.id)).toEqual([3, 2, 1])
  })

  it('does nothing to a timeline that is not in use', () => {
    const qc = new QueryClient()
    prependToTimeline(qc, [makePost({ id: 1 })])
    expect(qc.getQueryData(['timeline'])).toBeUndefined()
  })

  it('makes a timeline that is still loading start over, so a post made meanwhile is not lost', async () => {
    const qc = new QueryClient()
    const post = makePost({ id: 9, content: 'posted while loading' })
    let fetches = 0
    // The server's first answer was prepared before the post existed; the second one includes it.
    const queryFn = async () => {
      fetches += 1
      const mine = fetches
      await new Promise((r) => setTimeout(r, 30))
      return infinite(...(mine === 1 ? [] : [post]))
    }
    const observer = new QueryObserver(qc, { queryKey: ['timeline'], queryFn }) // the home page is looking at the timeline
    const unsubscribe = observer.subscribe(() => undefined)

    prependToTimeline(qc, [post]) // the user posts before the first answer arrives
    await vi.waitFor(() => expect(qc.getQueryData<ReturnType<typeof infinite>>(['timeline'])?.pages[0].items.map((p) => p.id)).toEqual([9]))
    unsubscribe()

    expect(fetches).toBe(2)
  })
})
