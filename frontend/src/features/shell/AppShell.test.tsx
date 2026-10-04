import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { makeUser } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { AppShell } from './AppShell'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function open(route = '/', user: { admin?: boolean } = {}, unread = 0) {
  server.use(
    http.get(`${BASE}/api/notifications/unread-count`, () => HttpResponse.json({ count: unread })),
    http.get(`${BASE}/api/trending/hashtags`, () => HttpResponse.json([{ name: 'java', postCount: 2, userCount: 2 }])),
    http.get(`${BASE}/api/users/suggestions`, () => HttpResponse.json([{ user: makeUser({ id: 5, username: 'sue_s', displayName: 'Sue S' }), mutualFollowCount: 1 }])),
  )
  return renderSignedIn(
    <>
      <Routes><Route element={<AppShell />}><Route path="/" element={<p>home</p>} /><Route path="/explore" element={<p>explore page</p>} /></Route></Routes>
      <Where />
    </>,
    { route, user },
  )
}

describe('the app shell', () => {
  it('has Home, Explore, Notifications, Bookmarks and Profile in the navigation', async () => {
    open()
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map((l) => l.getAttribute('aria-label'))).toEqual(['Home', 'Explore', 'Notifications', 'Bookmarks', 'Profile'])
    expect(within(nav).getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/explore')
    expect(within(nav).getByRole('link', { name: 'Bookmarks' })).toHaveAttribute('href', '/bookmarks')
  })

  it('shows how many notifications are unread on the Notifications link, and nothing when there are none', async () => {
    open('/', {}, 3)
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    const link = await within(nav).findByRole('link', { name: 'Notifications (3 unread)' })
    expect(link).toHaveAttribute('href', '/notifications')
    expect(link).toHaveTextContent('3')
  })

  it('has no badge when everything is read, and caps a long count', async () => {
    const { unmount } = open('/', {}, 0)
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Notifications' })).not.toHaveTextContent(/\d/)
    unmount()
    open('/', {}, 250)
    const main = await screen.findByRole('navigation', { name: 'Main' })
    expect(await within(main).findByRole('link', { name: 'Notifications (250 unread)' })).toHaveTextContent('99+')
  })

  it('shows the Reports link to admins only', async () => {
    open('/', { admin: true })
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/admin/reports')
  })

  it('does not show the Reports link to everyone else', async () => {
    open()
    await screen.findByRole('navigation', { name: 'Main' })
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument()
  })

  it('shows trends and who to follow in the right column, each with "Show more"', async () => {
    open()
    const trends = await screen.findByRole('region', { name: 'Trends' })
    expect(await within(trends).findByRole('link', { name: /#java/ })).toHaveAttribute('href', '/hashtag/java')
    expect(await within(trends).findByRole('link', { name: 'Show more' })).toHaveAttribute('href', '/explore')
    const who = await screen.findByRole('region', { name: 'Who to follow' })
    expect(await within(who).findByRole('link', { name: 'Show more' })).toHaveAttribute('href', '/explore')
  })

  it('opens Explore with the search filled in when you press Enter in the side search box', async () => {
    open()
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search XClone' }), 'hello world{Enter}')
    expect(await screen.findByText('explore page')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/explore?q=hello%20world')
  })

  it('ignores an empty search', async () => {
    open()
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search XClone' }), '   {Enter}')
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })

  it('leaves out the side search box on the Explore page, which has its own', async () => {
    open('/explore')
    await screen.findByText('explore page')
    expect(screen.queryByRole('searchbox', { name: 'Search XClone' })).not.toBeInTheDocument()
  })
})
