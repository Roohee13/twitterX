import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { PostResponse, ProfileResponse } from '../../lib/types'
import { makePost, makeProfile } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { ProfilePage } from './ProfilePage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const page = <T,>(items: T[] = []) => HttpResponse.json({ items, nextCursor: null })

/** A fake account on the fake server: the profile changes the way the real one does when you follow, mute or block it. */
function serve(initial: Partial<ProfileResponse> = {}, tabs: { posts?: PostResponse[]; replies?: PostResponse[]; likes?: PostResponse[] } = {}) {
  const state = { profile: makeProfile(initial), calls: [] as string[], bodies: {} as Record<string, unknown>, tabRequests: [] as string[] }
  const u = state.profile.username
  server.use(
    http.get(`${BASE}/api/users/${u}`, () => HttpResponse.json(state.profile)),
    http.post(`${BASE}/api/users/${u}/follow`, () => {
      state.calls.push('follow')
      if (state.profile.protectedAccount) {
        state.profile = { ...state.profile, followRequestedByMe: true }
        return new HttpResponse(null, { status: 202 })
      }
      state.profile = { ...state.profile, followedByMe: true, followerCount: state.profile.followerCount + 1 }
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete(`${BASE}/api/users/${u}/follow`, () => {
      state.calls.push('unfollow')
      state.profile = { ...state.profile, followRequestedByMe: false, followedByMe: false, followerCount: state.profile.followerCount - (state.profile.followedByMe ? 1 : 0) }
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${BASE}/api/users/${u}/mute`, () => ((state.calls.push('mute'), (state.profile = { ...state.profile, mutedByMe: true })), new HttpResponse(null, { status: 204 }))),
    http.delete(`${BASE}/api/users/${u}/mute`, () => ((state.calls.push('unmute'), (state.profile = { ...state.profile, mutedByMe: false })), new HttpResponse(null, { status: 204 }))),
    http.post(`${BASE}/api/users/${u}/block`, () => ((state.calls.push('block'), (state.profile = { ...state.profile, blockedByMe: true, followedByMe: false })), new HttpResponse(null, { status: 204 }))),
    http.delete(`${BASE}/api/users/${u}/block`, () => ((state.calls.push('unblock'), (state.profile = { ...state.profile, blockedByMe: false })), new HttpResponse(null, { status: 204 }))),
    http.post(`${BASE}/api/users/${u}/report`, async ({ request }) => ((state.bodies.report = await request.json()), new HttpResponse(null, { status: 204 }))),
    http.get(`${BASE}/api/users/${u}/:tab`, ({ params }) => {
      state.tabRequests.push(String(params.tab))
      return page(tabs[params.tab as 'posts' | 'replies' | 'likes'] ?? [])
    }),
  )
  return state
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function open(username = 'bob', search = '') {
  return renderSignedIn(
    <>
      <Routes>
        <Route path="/u/:username" element={<ProfilePage />} />
        <Route path="/u/:username/followers" element={<p>followers page</p>} />
        <Route path="/u/:username/following" element={<p>following page</p>} />
      </Routes>
      <Where />
    </>,
    { route: `/u/${username}${search}` },
  )
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })

describe('profile header', () => {
  it('shows the person, their bio with links, when they joined, and their counts as links', async () => {
    serve({ displayName: 'Bob Builder', bio: 'Builds things #diy see https://example.com', followerCount: 1, followingCount: 12 })
    open()

    expect(await screen.findByRole('heading', { name: 'Bob Builder', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('@bob')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '#diy' })).toHaveAttribute('href', '/hashtag/diy')
    expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute('target', '_blank')
    expect(screen.getByText('Joined March 2026')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '12 Following' })).toHaveAttribute('href', '/u/bob/following')
    expect(screen.getByRole('link', { name: '1 Follower' })).toHaveAttribute('href', '/u/bob/followers')
  })

  it('marks a protected account with a lock', async () => {
    serve({ protectedAccount: true })
    open()
    expect(await screen.findByLabelText('Protected account')).toBeInTheDocument()
  })

  it('offers "Edit profile" on your own page and no follow button', async () => {
    serve({ id: 1, username: 'alice', displayName: 'Alice' })
    open('alice')
    expect(await screen.findByRole('button', { name: 'Edit profile' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Follow/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Profile actions' })).not.toBeInTheDocument()
  })

  it('offers the Message button only when the server says you can message them', async () => {
    serve({ canMessage: true })
    const first = open()
    expect(await screen.findByRole('button', { name: 'Message Bob Builder' })).toBeInTheDocument()
    first.unmount()

    serve({ canMessage: false })
    open()
    expect(await screen.findByRole('heading', { name: 'Bob Builder', level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Message Bob Builder' })).not.toBeInTheDocument()
  })

  it('says when the account does not exist', async () => {
    server.use(http.get(`${BASE}/api/users/ghost`, () => HttpResponse.json({ status: 404, detail: 'User not found' }, { status: 404 })))
    open('ghost')
    expect(await screen.findByText("This account doesn't exist")).toBeInTheDocument()
  })
})

describe('profile tabs', () => {
  it('shows posts first, and loads replies and likes only when their tab is opened', async () => {
    const state = serve({}, { posts: [makePost({ content: 'a post' })], replies: [makePost({ content: 'a reply', replyToId: 3 })], likes: [makePost({ content: 'a liked post' })] })
    open()

    expect(await screen.findByText('a post')).toBeInTheDocument()
    expect(state.tabRequests).toEqual(['posts'])

    await userEvent.click(screen.getByRole('tab', { name: 'Replies' }))
    expect(await screen.findByText('a reply')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Replies' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('where')).toHaveTextContent('/u/bob?tab=replies')

    await userEvent.click(screen.getByRole('tab', { name: 'Likes' }))
    expect(await screen.findByText('a liked post')).toBeInTheDocument()
    expect(state.tabRequests).toEqual(['posts', 'replies', 'likes'])
  })

  it('opens straight on the tab in the address', async () => {
    serve({}, { replies: [makePost({ content: 'deep link reply' })] })
    open('bob', '?tab=replies')
    expect(await screen.findByText('deep link reply')).toBeInTheDocument()
  })

  it('has a friendly message for an empty tab, in the second person on your own page', async () => {
    serve({ id: 1, username: 'alice' })
    open('alice')
    expect(await screen.findByText("You haven't posted yet")).toBeInTheDocument()
  })

  it("says so when the posts are hidden because of a block by them", async () => {
    const state = serve()
    server.use(http.get(`${BASE}/api/users/bob/posts`, () => (state.tabRequests.push('posts'), HttpResponse.json({ status: 403, detail: 'This action is not allowed because of a block' }, { status: 403 }))))
    open()
    expect(await screen.findByText("You can't see these posts")).toBeInTheDocument()
  })
})

describe('following', () => {
  it('follows a public account at once and keeps the counts right', async () => {
    const state = serve({ followerCount: 5 })
    open()

    await userEvent.click(await screen.findByRole('button', { name: 'Follow @bob' }))

    expect(button('Unfollow @bob')).toHaveTextContent('Following')
    expect(screen.getByRole('link', { name: '6 Followers' })).toBeInTheDocument()
    await waitFor(() => expect(state.calls).toEqual(['follow']))
  })

  it('goes back and says why when following fails', async () => {
    serve()
    server.use(http.post(`${BASE}/api/users/bob/follow`, () => HttpResponse.json({ status: 403, detail: 'This action is not allowed because of a block' }, { status: 403 })))
    open()

    await userEvent.click(await screen.findByRole('button', { name: 'Follow @bob' }))

    expect(await screen.findByText('This action is not allowed because of a block')).toBeInTheDocument()
    expect(button('Follow @bob')).toBeInTheDocument()
  })

  it('asks before unfollowing, and does nothing if you cancel', async () => {
    const state = serve({ followedByMe: true, followerCount: 5 })
    open()

    await userEvent.click(await screen.findByRole('button', { name: 'Unfollow @bob' }))
    const dialog = await screen.findByRole('dialog', { name: 'Unfollow @bob?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(state.calls).toEqual([])

    await userEvent.click(button('Unfollow @bob'))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Unfollow @bob?' })).getByRole('button', { name: 'Unfollow' }))

    await waitFor(() => expect(state.calls).toEqual(['unfollow']))
    expect(await screen.findByRole('button', { name: 'Follow @bob' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '4 Followers' })).toBeInTheDocument()
  })

  it('turns "Follow" on a protected account into a request that can be withdrawn without asking', async () => {
    const state = serve({ protectedAccount: true, followerCount: 5 })
    open()

    await userEvent.click(await screen.findByRole('button', { name: 'Follow @bob' }))

    const requested = await screen.findByRole('button', { name: 'Withdraw follow request to @bob' })
    expect(requested).toHaveTextContent('Requested')
    expect(screen.getByRole('link', { name: '5 Followers' })).toBeInTheDocument() // not a follower yet
    await userEvent.click(requested)

    await waitFor(() => expect(state.calls).toEqual(['follow', 'unfollow']))
    expect(await screen.findByRole('button', { name: 'Follow @bob' })).toBeInTheDocument()
  })
})

describe('protected and blocked accounts', () => {
  it('shows a lock screen instead of posts, without even asking for them', async () => {
    const state = serve({ protectedAccount: true })
    open()

    expect(await screen.findByText('These posts are protected')).toBeInTheDocument()
    expect(screen.getByText(/Follow to send a request/)).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(state.tabRequests).toEqual([])
  })

  it('tells you the request is waiting', async () => {
    serve({ protectedAccount: true, followRequestedByMe: true })
    open()
    expect(await screen.findByText(/Your request is waiting/)).toBeInTheDocument()
  })

  it('shows the posts to an approved follower of a protected account', async () => {
    serve({ protectedAccount: true, followedByMe: true }, { posts: [makePost({ content: 'followers only' })] })
    open()
    expect(await screen.findByText('followers only')).toBeInTheDocument()
  })

  it('hides everything for an account you blocked, and lets you unblock it', async () => {
    const state = serve({ blockedByMe: true })
    open()

    expect(await screen.findByText('You blocked @bob')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    await userEvent.click(button('Unblock'))

    await waitFor(() => expect(state.calls).toEqual(['unblock']))
    expect(await screen.findByRole('tab', { name: 'Posts' })).toBeInTheDocument()
  })
})

describe('the profile actions menu', () => {
  it('mutes and unmutes, with a note about what muting does', async () => {
    const state = serve()
    open()

    await userEvent.click(await screen.findByRole('button', { name: 'Profile actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mute @bob' }))

    expect(await screen.findByText(/Muted @bob\. You won't see their posts or notifications\./)).toBeInTheDocument()
    expect(await screen.findByText('Muted')).toBeInTheDocument()
    await userEvent.click(button('Profile actions'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unmute @bob' }))
    await waitFor(() => expect(state.calls).toEqual(['mute', 'unmute']))
    await waitFor(() => expect(screen.queryByText('Muted')).not.toBeInTheDocument())
  })

  it('blocks only after an explanation and a confirmation', async () => {
    const state = serve({ followedByMe: true })
    open()

    await userEvent.click(await screen.findByRole('button', { name: 'Profile actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Block @bob' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block @bob?' })
    expect(dialog).toHaveTextContent('You will stop following each other')
    expect(state.calls).toEqual([])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block' }))

    expect(await screen.findByText('You blocked @bob')).toBeInTheDocument()
    expect(state.calls).toEqual(['block'])
  })

  it('reports the account with a reason', async () => {
    const state = serve()
    open()

    await userEvent.click(await screen.findByRole('button', { name: 'Profile actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Report @bob' }))
    const dialog = await screen.findByRole('dialog', { name: 'Report @bob' })
    expect(within(dialog).getByRole('button', { name: 'Report' })).toBeDisabled()
    await userEvent.click(within(dialog).getByLabelText("It's spam"))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Report' }))

    expect(await screen.findByText(/Thanks for letting us know/)).toBeInTheDocument()
    expect(state.bodies.report).toEqual({ reason: 'SPAM' })
  })

  it('takes "already reported" calmly', async () => {
    serve()
    server.use(http.post(`${BASE}/api/users/bob/report`, () => HttpResponse.json({ status: 409, detail: 'You have already reported this user' }, { status: 409 })))
    open()

    await userEvent.click(await screen.findByRole('button', { name: 'Profile actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Report @bob' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByLabelText('Something else'))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Report' }))

    expect(await screen.findByText('You already reported this account.')).toBeInTheDocument()
  })

  it('keeps the menu for a blocked account, and shows "Blocked" where the follow button would be', async () => {
    serve({ blockedByMe: true })
    open()
    expect(await screen.findByRole('button', { name: 'Unblock @bob' })).toHaveTextContent('Blocked')
    expect(screen.getByRole('button', { name: 'Profile actions' })).toBeInTheDocument()
  })
})
