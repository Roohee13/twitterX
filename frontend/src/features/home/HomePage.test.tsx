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
