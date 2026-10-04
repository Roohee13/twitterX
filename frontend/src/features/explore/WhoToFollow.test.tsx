import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { makeUser } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { WhoToFollow } from './WhoToFollow'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const sue = makeUser({ id: 5, username: 'sue_s', displayName: 'Sue S' })
const priv = makeUser({ id: 6, username: 'pat_p', displayName: 'Pat P', protectedAccount: true })

function serve(suggestions: unknown[]) {
  const limits: Array<string | null> = []
  server.use(http.get(`${BASE}/api/users/suggestions`, ({ request }) => (limits.push(new URL(request.url).searchParams.get('limit')), HttpResponse.json(suggestions))))
  return limits
}

describe('WhoToFollow', () => {
  it('lists suggestions with who they are followed by, and a lock for protected accounts', async () => {
    const limits = serve([{ user: sue, mutualFollowCount: 3 }, { user: priv, mutualFollowCount: 1 }, { user: makeUser({ id: 7, username: 'new_n', displayName: 'New N' }), mutualFollowCount: 0 }])
    renderSignedIn(<WhoToFollow limit={3} />)

    const panel = await screen.findByRole('region', { name: 'Who to follow' })
    expect(limits).toEqual(['3'])
    expect(within(panel).getByText('Followed by 3 people you follow')).toBeInTheDocument()
    expect(within(panel).getByText('Followed by 1 person you follow')).toBeInTheDocument()
    expect(within(panel).getAllByText(/Followed by/)).toHaveLength(2) // a popular account has no "followed by" line
    expect(within(panel).getByLabelText('Protected account')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /Sue S/ })).toHaveAttribute('href', '/u/sue_s')
  })

  it('follows a public account and shows "Following"', async () => {
    const followed = vi.fn()
    serve([{ user: sue, mutualFollowCount: 0 }])
    server.use(http.post(`${BASE}/api/users/sue_s/follow`, () => (followed(), new HttpResponse(null, { status: 204 }))))
    renderSignedIn(<WhoToFollow limit={3} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Follow @sue_s' }))

    expect(await screen.findByText('Following')).toBeInTheDocument()
    expect(followed).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Follow @sue_s' })).not.toBeInTheDocument()
  })

  it('shows "Requested" for a protected account', async () => {
    serve([{ user: priv, mutualFollowCount: 0 }])
    server.use(http.post(`${BASE}/api/users/pat_p/follow`, () => new HttpResponse(null, { status: 202 })))
    renderSignedIn(<WhoToFollow limit={3} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Follow @pat_p' }))

    expect(await screen.findByText('Requested')).toBeInTheDocument()
  })

  it('keeps the button and explains when following fails', async () => {
    serve([{ user: sue, mutualFollowCount: 0 }])
    server.use(http.post(`${BASE}/api/users/sue_s/follow`, () => HttpResponse.json({ status: 403, detail: 'This action is not allowed because of a block' }, { status: 403 })))
    renderSignedIn(<WhoToFollow limit={3} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Follow @sue_s' }))

    expect(await screen.findByText('This action is not allowed because of a block')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Follow @sue_s' })).toBeEnabled())
  })

  it('shows nothing at all when there is nobody to suggest', async () => {
    serve([])
    const { container } = renderSignedIn(<WhoToFollow limit={3} />)
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
  })
})
