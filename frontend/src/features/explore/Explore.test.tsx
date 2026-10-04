import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { makePost, makeUser } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { ExplorePage } from './ExplorePage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const page = <T,>(items: T[] = []) => HttpResponse.json({ items, nextCursor: null })

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

/** Serves trending, suggestions and both searches, recording what was searched for. */
function serve(options: { posts?: unknown[]; people?: unknown[]; trending?: unknown[]; suggestions?: unknown[] } = {}) {
  const searched = { posts: [] as string[], people: [] as string[] }
  server.use(
    http.get(`${BASE}/api/trending/hashtags`, () => HttpResponse.json(options.trending ?? [])),
    http.get(`${BASE}/api/users/suggestions`, () => HttpResponse.json(options.suggestions ?? [])),
    http.get(`${BASE}/api/posts/search`, ({ request }) => (searched.posts.push(new URL(request.url).searchParams.get('q') ?? ''), page(options.posts))),
    http.get(`${BASE}/api/users/search`, ({ request }) => (searched.people.push(new URL(request.url).searchParams.get('q') ?? ''), HttpResponse.json(options.people ?? []))),
  )
  return searched
}

function open(search = '') {
  return renderSignedIn(<><Routes><Route path="/explore" element={<ExplorePage />} /></Routes><Where /></>, { route: `/explore${search}` })
}

/** The page renders once the signed-in session has been restored, so wait for the box. */
const box = () => screen.findByRole('searchbox', { name: 'Search' })

describe('Explore without a search', () => {
  it('shows what is trending, linking to each hashtag, and who to follow', async () => {
    serve({
      trending: [{ name: 'java', postCount: 3, userCount: 2 }, { name: 'spring', postCount: 1, userCount: 1 }],
      suggestions: [{ user: makeUser({ id: 5, username: 'sue_s', displayName: 'Sue S' }), mutualFollowCount: 2 }],
    })
    open()

    const trending = await screen.findByRole('region', { name: 'Trending' })
    expect(await within(trending).findByRole('link', { name: /#java/ })).toHaveAttribute('href', '/hashtag/java')
    expect(within(trending).getByText('3 posts · 2 people')).toBeInTheDocument()
    expect(within(trending).getByText('1 post · 1 person')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Who to follow' })).toHaveTextContent('Sue S')
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('says so when nothing is trending', async () => {
    serve()
    open()
    expect(await screen.findByText(/Nothing is trending yet/)).toBeInTheDocument()
  })
})

describe('searching', () => {
  it('puts the search in the address at once, but asks the server only after typing stops, and only once', async () => {
    const searched = serve({ posts: [makePost({ content: 'all about java' })] })
    open()

    await userEvent.type(await box(), 'java')

    expect(screen.getByTestId('where')).toHaveTextContent('/explore?q=java')
    expect(await screen.findByText('all about java')).toBeInTheDocument()
    expect(searched.posts).toEqual(['java']) // not "j", "ja", "jav"
  })

  it('does not search posts for a single character, and says why', async () => {
    const searched = serve()
    open()

    await userEvent.type(await box(), 'a')

    expect(await screen.findByText('Keep typing')).toBeInTheDocument()
    expect(screen.getByText(/at least 2 characters/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 450))
    expect(searched.posts).toEqual([])
  })

  it('searches people on their own tab', async () => {
    const searched = serve({ people: [makeUser({ id: 8, username: 'java_jim', displayName: 'Jim J' })] })
    open('?q=java')
    await screen.findByRole('tab', { name: 'posts' })

    await userEvent.click(screen.getByRole('tab', { name: 'people' }))

    expect(await screen.findByRole('link', { name: /Jim J/ })).toHaveAttribute('href', '/u/java_jim')
    expect(screen.getByRole('tab', { name: 'people' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('where')).toHaveTextContent('tab=people')
    expect(searched.people).toEqual(['java'])
  })

  it('opens on the people tab for a search that starts with @', async () => {
    const searched = serve({ people: [makeUser({ id: 9, username: 'alice_w', displayName: 'Alice W' })] })
    open()

    await userEvent.type(await box(), '@ali')

    expect(await screen.findByRole('link', { name: /Alice W/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'people' })).toHaveAttribute('aria-selected', 'true')
    expect(searched.posts).toEqual([])
    expect(searched.people).toEqual(['@ali'])
  })

  it('has a message for each tab when nothing matches', async () => {
    serve()
    open('?q=zzzz')
    expect(await screen.findByText('No posts match “zzzz”')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'people' }))
    expect(await screen.findByText('No people match “zzzz”')).toBeInTheDocument()
  })

  it('opens straight on a search from the address', async () => {
    serve({ people: [makeUser({ id: 8, displayName: 'Deep Link', username: 'deep_link' })] })
    open('?q=deep&tab=people')
    expect(await screen.findByRole('link', { name: /Deep Link/ })).toBeInTheDocument()
    expect(await box()).toHaveValue('deep')
  })

  it('goes back to browsing when the search is cleared', async () => {
    serve({ trending: [{ name: 'java', postCount: 1, userCount: 1 }] })
    open('?q=java')
    await screen.findByRole('tab', { name: 'posts' })

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(await screen.findByRole('region', { name: 'Trending' })).toBeInTheDocument()
    expect(await box()).toHaveValue('')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/explore$/)
  })

  it('treats spaces alone as no search', async () => {
    const searched = serve()
    open()
    await userEvent.type(await box(), '   ')
    await new Promise((r) => setTimeout(r, 450))
    expect(searched.posts).toEqual([])
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('offers a retry when the search fails', async () => {
    serve()
    let fail = true
    server.use(http.get(`${BASE}/api/users/search`, () => (fail ? HttpResponse.json({ status: 500, detail: 'Search is down' }, { status: 500 }) : HttpResponse.json([makeUser({ id: 8, displayName: 'Back Again', username: 'back_again' })]))))
    open('?q=ab&tab=people')

    expect(await screen.findByRole('alert')).toHaveTextContent('Search is down')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: /Back Again/ })).toBeInTheDocument()
  }, 20_000)
})

describe('search results are real posts', () => {
  it('act like any post: they can be opened and liked from the results', async () => {
    serve({ posts: [makePost({ id: 61, content: 'findable post' })] })
    server.use(http.post(`${BASE}/api/posts/61/like`, () => new HttpResponse(null, { status: 204 })))
    open('?q=findable')

    await screen.findByText('findable post')
    await userEvent.click(screen.getByRole('button', { name: 'Like' }))

    expect(await waitFor(() => screen.getByRole('button', { name: 'Unlike' }))).toBeInTheDocument()
  })
})
