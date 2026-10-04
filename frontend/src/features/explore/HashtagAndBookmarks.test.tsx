import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { makePost } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { BookmarksPage } from '../bookmarks/BookmarksPage'
import { HashtagPage } from './HashtagPage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const page = <T,>(items: T[] = []) => HttpResponse.json({ items, nextCursor: null })

describe('HashtagPage', () => {
  const open = (path: string) => renderSignedIn(<Routes><Route path="/hashtag/:name" element={<HashtagPage />} /></Routes>, { route: path })

  it('lists the posts for a tag, titled with the tag in lower case', async () => {
    const asked: string[] = []
    server.use(http.get(`${BASE}/api/hashtags/:name/posts`, ({ params }) => (asked.push(String(params.name)), page([makePost({ content: 'first #java post' }), makePost({ content: 'second #java post' })]))))

    open('/hashtag/Java')

    expect(await screen.findByRole('heading', { name: '#java' })).toBeInTheDocument()
    expect(await screen.findAllByRole('article')).toHaveLength(2)
    expect(asked).toEqual(['java'])
    expect(screen.getByRole('link', { name: 'Back to Explore' })).toHaveAttribute('href', '/explore')
  })

  it('has a message when nobody used the tag', async () => {
    server.use(http.get(`${BASE}/api/hashtags/:name/posts`, () => page([])))
    open('/hashtag/lonely')
    expect(await screen.findByText('No posts with #lonely yet')).toBeInTheDocument()
  })
})

describe('BookmarksPage', () => {
  const open = () => renderSignedIn(<Routes><Route path="/bookmarks" element={<BookmarksPage />} /></Routes>, { route: '/bookmarks' })

  it('lists saved posts, and removing a bookmark takes the post off the list at once', async () => {
    let saved = [makePost({ id: 1, content: 'keep this', bookmarkedByMe: true }), makePost({ id: 2, content: 'and this', bookmarkedByMe: true })]
    server.use(
      http.get(`${BASE}/api/bookmarks`, () => page(saved)),
      http.delete(`${BASE}/api/posts/1/bookmark`, () => ((saved = saved.filter((p) => p.id !== 1)), new HttpResponse(null, { status: 204 }))),
    )
    open()
    expect(await screen.findByText('keep this')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Remove bookmark' })).toHaveLength(2)

    await userEvent.click(screen.getAllByRole('button', { name: 'Remove bookmark' })[0])

    await waitFor(() => expect(screen.queryByText('keep this')).not.toBeInTheDocument())
    expect(screen.getByText('and this')).toBeInTheDocument()
  })

  it('still lists the posts when the server does not send the bookmarkedByMe flag (an older backend)', async () => {
    const withoutFlag = { ...makePost({ id: 3, content: 'listed anyway' }), bookmarkedByMe: undefined }
    server.use(http.get(`${BASE}/api/bookmarks`, () => page([withoutFlag])))
    open()
    expect(await screen.findByText('listed anyway')).toBeInTheDocument()
  })

  it('invites you to save posts when there are none', async () => {
    server.use(http.get(`${BASE}/api/bookmarks`, () => page([])))
    open()
    expect(await screen.findByText('Save posts for later')).toBeInTheDocument()
  })
})
