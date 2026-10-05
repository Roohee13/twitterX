import { focusManager } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { makePost, makeUser } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { HomePage } from './HomePage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
  localStorage.setItem('xclone.homeTab', 'following') // these tests are about the Following timeline; Home opens on "For you" by default
})
afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const renderHome = () => renderSignedIn(<Routes><Route path="/" element={<HomePage />} /></Routes>)

/** jsdom has no IntersectionObserver; this one lets a test decide when the bottom of the list "scrolls into view". */
function stubObserver() {
  const callbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) { callbacks.push(cb) }
    observe() {}
    disconnect() {}
  })
  return () => callbacks.at(-1)?.([{ isIntersecting: true }])
}

describe('HomePage', () => {
  it('shows the timeline in the order the server returns it (newest first)', async () => {
    server.use(http.get(`${BASE}/api/timeline`, () => HttpResponse.json({ items: [makePost({ content: 'newest' }), makePost({ content: 'older' })], nextCursor: null })))

    renderHome()

    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument()
    const posts = await screen.findAllByRole('article')
    expect(posts.map((p) => p.textContent)).toEqual([expect.stringContaining('newest'), expect.stringContaining('older')])
  })

  it('invites a new user to follow people when the timeline is empty', async () => {
    server.use(http.get(`${BASE}/api/timeline`, () => HttpResponse.json({ items: [], nextCursor: null })))
    renderHome()
    expect(await screen.findByText('Welcome to XClone')).toBeInTheDocument()
    expect(screen.getByText(/Follow people/)).toBeInTheDocument()
  })

  it('offers a retry when loading fails', async () => {
    let fail = true
    server.use(http.get(`${BASE}/api/timeline`, () => (fail ? HttpResponse.json({ status: 403, detail: 'Nope' }, { status: 403 }) : HttpResponse.json({ items: [makePost({ content: 'back again' })], nextCursor: null }))))
    renderHome()

    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('back again')).toBeInTheDocument()
  })

  it('loads the next page, with the cursor the server gave, when the bottom comes into view', async () => {
    const seen: Array<string | null> = []
    server.use(
      http.get(`${BASE}/api/timeline`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        seen.push(cursor)
        return cursor
          ? HttpResponse.json({ items: [makePost({ content: 'page two post' })], nextCursor: null })
          : HttpResponse.json({ items: [makePost({ content: 'page one post' })], nextCursor: 321 })
      }),
    )
    const scrollToBottom = stubObserver()
    renderHome()
    await screen.findByText('page one post')

    act(() => scrollToBottom())

    expect(await screen.findByText('page two post')).toBeInTheDocument()
    expect(screen.getByText('page one post')).toBeInTheDocument()
    expect(seen).toEqual([null, '321'])
  })

  it('does not break when two people repost the same post (same id on two rows)', async () => {
    const original = makePost({ id: 77, content: 'popular' })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    server.use(
      http.get(`${BASE}/api/timeline`, () =>
        HttpResponse.json({
          items: [
            { ...original, repostedBy: makeUser({ id: 1, displayName: 'First' }) },
            { ...original, repostedBy: makeUser({ id: 2, displayName: 'Second' }) },
          ],
          nextCursor: null,
        }),
      ),
    )

    renderHome()

    expect(await screen.findAllByText('popular')).toHaveLength(2)
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/)
    error.mockRestore()
  })

  it('the refresh button goes back to the first page', async () => {
    let calls = 0
    server.use(
      http.get(`${BASE}/api/timeline`, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor')
        if (cursor) return HttpResponse.json({ items: [makePost({ content: 'old page' })], nextCursor: null })
        calls += 1
        return HttpResponse.json({ items: [makePost({ content: calls === 1 ? 'first load' : 'after refresh' })], nextCursor: 5 })
      }),
    )
    const scrollToBottom = stubObserver()
    vi.stubGlobal('scrollTo', vi.fn())
    renderHome()
    await screen.findByText('first load')
    act(() => scrollToBottom())
    await screen.findByText('old page')

    await userEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))

    expect(await screen.findByText('after refresh')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('old page')).not.toBeInTheDocument())
  })

  it('checks for new posts when the tab regains focus after a few seconds', async () => {
    let calls = 0
    server.use(
      http.get(`${BASE}/api/timeline`, () => {
        calls += 1
        return HttpResponse.json({ items: [makePost({ content: calls === 1 ? 'before' : 'a new post arrived' })], nextCursor: null })
      }),
    )
    renderHome()
    await screen.findByText('before')

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 11_000 }) // later than the 10 second freshness window
    await act(async () => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await new Promise((resolve) => setTimeout(resolve, 0)) // React Query decides what is stale a tick after the focus event
    })
    vi.useRealTimers()

    expect(await screen.findByText('a new post arrived')).toBeInTheDocument()
  })
})

describe('the For you and Following tabs', () => {
  const forYouPosts = [makePost({ content: 'ranked first' }), makePost({ content: 'ranked second' })]
  const followingPosts = [makePost({ content: 'from someone I follow' })]
  const calls = { forYou: 0, following: 0 }

  function serveFeeds() {
    calls.forYou = 0
    calls.following = 0
    server.use(
      http.get(`${BASE}/api/timeline/for-you`, () => {
        calls.forYou += 1
        return HttpResponse.json({ items: forYouPosts, nextCursor: null })
      }),
      http.get(`${BASE}/api/timeline`, () => {
        calls.following += 1
        return HttpResponse.json({ items: followingPosts, nextCursor: null })
      }),
    )
  }
  const tab = (name: string) => screen.getByRole('tab', { name })

  it('opens on "For you" for someone who never chose, and loads only that feed', async () => {
    localStorage.removeItem('xclone.homeTab')
    serveFeeds()

    renderHome()

    expect(await screen.findByText('ranked first')).toBeInTheDocument()
    expect(tab('For you')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Following')).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByText('from someone I follow')).not.toBeInTheDocument()
    expect(calls).toEqual({ forYou: 1, following: 0 })
  })

  it('switching to Following shows that feed (fetched on demand), and switching back does not lose the first', async () => {
    localStorage.removeItem('xclone.homeTab')
    serveFeeds()
    renderHome()
    await screen.findByText('ranked first')

    await userEvent.click(tab('Following'))

    expect(await screen.findByText('from someone I follow')).toBeInTheDocument()
    expect(screen.queryByText('ranked first')).not.toBeInTheDocument()
    expect(tab('Following')).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(tab('For you'))
    expect(await screen.findByText('ranked first')).toBeInTheDocument()
    expect(calls.following).toBe(1)
  })

  it('remembers the last tab for next time', async () => {
    localStorage.removeItem('xclone.homeTab')
    serveFeeds()
    const first = renderHome()
    await screen.findByText('ranked first')
    await userEvent.click(tab('Following'))
    await screen.findByText('from someone I follow')
    expect(localStorage.getItem('xclone.homeTab')).toBe('following')
    first.unmount()

    renderHome()

    expect(await screen.findByText('from someone I follow')).toBeInTheDocument()
    expect(tab('Following')).toHaveAttribute('aria-selected', 'true')
  })

  it('works with the arrow keys, moving focus with the selection', async () => {
    localStorage.removeItem('xclone.homeTab')
    serveFeeds()
    renderHome()
    await screen.findByText('ranked first')
    tab('For you').focus()

    await userEvent.keyboard('{ArrowRight}')

    expect(tab('Following')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Following')).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(tab('For you')).toHaveFocus()
  })

  it('the refresh button reloads only the feed on screen', async () => {
    localStorage.removeItem('xclone.homeTab')
    serveFeeds()
    renderHome()
    await screen.findByText('ranked first')
    await userEvent.click(tab('Following'))
    await screen.findByText('from someone I follow')

    await userEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))

    await waitFor(() => expect(calls.following).toBe(2))
    expect(calls.forYou).toBe(1)
  })

  it('a feed that is empty says so in its own words', async () => {
    localStorage.removeItem('xclone.homeTab')
    server.use(http.get(`${BASE}/api/timeline/for-you`, () => HttpResponse.json({ items: [], nextCursor: null })))
    renderHome()
    expect(await screen.findByText('Nothing to show yet')).toBeInTheDocument()
    expect(screen.queryByText('Welcome to XClone')).not.toBeInTheDocument()
  })

  it('a like made in one feed shows in the other (they share the cached post)', async () => {
    localStorage.removeItem('xclone.homeTab')
    let liked = false // the fake server remembers the like, as the real one does
    const shared = () => makePost({ id: 4242, content: 'in both feeds', likeCount: liked ? 4 : 3, likedByMe: liked })
    server.use(
      http.get(`${BASE}/api/timeline/for-you`, () => HttpResponse.json({ items: [shared()], nextCursor: null })),
      http.get(`${BASE}/api/timeline`, () => HttpResponse.json({ items: [shared()], nextCursor: null })),
      http.post(`${BASE}/api/posts/4242/like`, () => {
        liked = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderHome()
    await screen.findByText('in both feeds')
    await userEvent.click(screen.getByRole('button', { name: 'Like' }))
    await screen.findByRole('button', { name: 'Unlike' })

    await userEvent.click(tab('Following'))

    expect(await screen.findByText('in both feeds')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Unlike' })).toBeInTheDocument()
  })

  it('still works when storage is blocked', async () => {
    serveFeeds()
    // Only the tab choice is blocked (the test's own sign-in needs the rest of storage).
    const realGet = Storage.prototype.getItem
    const realSet = Storage.prototype.setItem
    const blocked = () => new DOMException('blocked', 'SecurityError')
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) { if (key === 'xclone.homeTab') throw blocked(); return realGet.call(this, key) })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) { if (key === 'xclone.homeTab') throw blocked(); realSet.call(this, key, value) })
    renderHome()
    expect(await screen.findByText('ranked first')).toBeInTheDocument()
    await userEvent.click(tab('Following'))
    expect(await screen.findByText('from someone I follow')).toBeInTheDocument()
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
