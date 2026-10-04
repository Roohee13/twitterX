import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { makeProfile, makeUser } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { AppShell } from '../shell/AppShell'
import { FollowListPage } from './FollowListPage'
import { FollowRequestsPage } from './FollowRequestsPage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const page = <T,>(items: T[] = []) => HttpResponse.json({ items, nextCursor: null })

describe('followers and following lists', () => {
  function open(kind: 'followers' | 'following') {
    server.use(http.get(`${BASE}/api/users/bob`, () => HttpResponse.json(makeProfile())))
    return renderSignedIn(
      <Routes>
        <Route path="/u/:username/followers" element={<FollowListPage kind="followers" />} />
        <Route path="/u/:username/following" element={<FollowListPage kind="following" />} />
        <Route path="/u/:username" element={<p>profile page</p>} />
      </Routes>,
      { route: `/u/bob/${kind}` },
    )
  }

  it('lists the people, each linking to their profile, with a lock for protected ones', async () => {
    server.use(http.get(`${BASE}/api/users/bob/followers`, () => page([makeUser({ id: 21, username: 'fan_one', displayName: 'Fan One' }), makeUser({ id: 22, username: 'quiet', displayName: 'Quiet One', protectedAccount: true })])))
    open('followers')

    const first = await screen.findByRole('link', { name: /Fan One/ })
    expect(first).toHaveAttribute('href', '/u/fan_one')
    expect(within(screen.getByRole('link', { name: /Quiet One/ })).getByLabelText('Protected account')).toBeInTheDocument()
  })

  it('switches between followers and following', async () => {
    server.use(
      http.get(`${BASE}/api/users/bob/followers`, () => page([makeUser({ id: 21, displayName: 'A Follower', username: 'a_follower' })])),
      http.get(`${BASE}/api/users/bob/following`, () => page([makeUser({ id: 22, displayName: 'A Followee', username: 'a_followee' })])),
    )
    open('followers')
    await screen.findByText('A Follower')

    await userEvent.click(screen.getByRole('link', { name: 'Following' }))

    expect(await screen.findByText('A Followee')).toBeInTheDocument()
  })

  it('has an empty message for each list', async () => {
    server.use(http.get(`${BASE}/api/users/bob/following`, () => page([])))
    open('following')
    expect(await screen.findByText('Not following anyone yet')).toBeInTheDocument()
  })

  it('explains when a protected account hides its lists from you', async () => {
    server.use(http.get(`${BASE}/api/users/bob/followers`, () => HttpResponse.json({ status: 403, detail: 'This account is protected' }, { status: 403 })))
    open('followers')
    expect(await screen.findByText("You can't see this list")).toBeInTheDocument()
  })
})

describe('follow requests', () => {
  const renderRequests = () => renderSignedIn(<Routes><Route path="/follow-requests" element={<FollowRequestsPage />} /></Routes>, { route: '/follow-requests' })

  it('lists who is waiting, and approving one answers the server and takes them off the list', async () => {
    let waiting = [makeUser({ id: 31, username: 'carol_k', displayName: 'Carol K' }), makeUser({ id: 32, username: 'dave_d', displayName: 'Dave D' })]
    const answered: string[] = []
    server.use(
      http.get(`${BASE}/api/users/me/follow-requests`, () => page(waiting)),
      http.get(`${BASE}/api/users/alice`, () => HttpResponse.json(makeProfile({ id: 1, username: 'alice' }))),
      http.post(`${BASE}/api/users/me/follow-requests/:name/:action`, ({ params }) => {
        answered.push(`${params.action}:${params.name}`)
        waiting = waiting.filter((u) => u.username !== params.name)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderRequests()

    expect(await screen.findByText('Carol K')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve Carol K' }))
    expect(await screen.findByText('@carol_k now follows you.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Carol K')).not.toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Deny Dave D' }))
    expect(await screen.findByText('Request from @dave_d denied.')).toBeInTheDocument()
    expect(answered).toEqual(['approve:carol_k', 'deny:dave_d'])
    expect(await screen.findByText('No pending requests')).toBeInTheDocument()
  })

  it('takes a request that was already answered elsewhere calmly', async () => {
    let waiting = [makeUser({ id: 31, username: 'carol_k', displayName: 'Carol K' })]
    server.use(
      http.get(`${BASE}/api/users/me/follow-requests`, () => page(waiting)),
      http.get(`${BASE}/api/users/alice`, () => HttpResponse.json(makeProfile({ id: 1, username: 'alice' }))),
      http.post(`${BASE}/api/users/me/follow-requests/carol_k/approve`, () => {
        waiting = []
        return HttpResponse.json({ status: 404, detail: 'No pending follow request from this user' }, { status: 404 })
      }),
    )
    renderRequests()

    await userEvent.click(await screen.findByRole('button', { name: 'Approve Carol K' }))

    expect(await screen.findByText('No pending requests')).toBeInTheDocument()
    expect(screen.queryByText('No pending follow request from this user')).not.toBeInTheDocument()
  })

  it('is empty at first, with a hint', async () => {
    server.use(http.get(`${BASE}/api/users/me/follow-requests`, () => page([])))
    renderRequests()
    expect(await screen.findByText('No pending requests')).toBeInTheDocument()
    expect(screen.getByText(/asks to follow your protected account/)).toBeInTheDocument()
  })
})

describe('navigation', () => {
  const shell = (user = {}) => {
    server.use(http.get(`${BASE}/api/trending/hashtags`, () => HttpResponse.json([])), http.get(`${BASE}/api/users/suggestions`, () => HttpResponse.json([])))
    return renderSignedIn(<Routes><Route element={<AppShell />}><Route path="/" element={<p>home</p>} /></Route></Routes>, { user })
  }

  it('links to your own profile', async () => {
    shell()
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/u/alice')
    expect(within(nav).queryByRole('link', { name: 'Follow requests' })).not.toBeInTheDocument()
  })

  it('adds "Follow requests" for a protected account only', async () => {
    shell({ protectedAccount: true })
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Follow requests' })).toHaveAttribute('href', '/follow-requests')
  })
})
