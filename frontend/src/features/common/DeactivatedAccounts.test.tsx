import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { ConversationResponse, MessageResponse, UserSummary } from '../../lib/types'
import { makePost, makeProfile, makeUser } from '../../test/fixtures'
import { BASE, me, renderSignedIn, server } from '../../test/render'
import { ChatPage } from '../messages/ChatPage'
import { ConversationRow } from '../messages/ConversationRow'
import { PostCard } from '../posts/PostCard'
import { FollowListPage } from '../profile/FollowListPage'
import { ProfilePage } from '../profile/ProfilePage'

// A deactivated account reaches the app as the blank "XClone user" the server makes of it. These tests check that every screen then shows
// exactly that and nothing more: no handle, no link, no picture, nothing to click.

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const page = <T,>(items: T[] = []) => HttpResponse.json({ items, nextCursor: null })
/** What the server sends for a deactivated person. */
const ghost = (id = 77): UserSummary => ({ id, username: '', displayName: 'XClone user', avatarUrl: null, protectedAccount: false, unavailable: true })

describe('the profile of a deactivated account', () => {
  const blank = makeProfile({ id: 77, username: '', displayName: 'XClone user', bio: null, avatarUrl: null, bannerUrl: null, createdAt: null, followerCount: 0, followingCount: 0, unavailable: true })

  function open() {
    let postRequests = 0
    server.use(
      http.get(`${BASE}/api/users/old_name`, () => HttpResponse.json(blank)),
      http.get(`${BASE}/api/users/old_name/:tab`, () => {
        postRequests += 1
        return page()
      }),
    )
    renderSignedIn(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/old_name' })
    return () => postRequests
  }

  it('shows only "XClone user" and that the account is unavailable', async () => {
    open()

    expect(await screen.findByRole('heading', { name: 'XClone user', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('This account is unavailable.')).toBeInTheDocument()
    // Nothing of the account is on the page: not the handle from the address, not a join date, counts, buttons or tabs.
    expect(screen.queryByText(/old_name/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Joined/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Followers|Following/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull() // no picture, no banner image
  })

  it('does not even ask for the account\'s posts', async () => {
    const requests = open()
    await screen.findByText('This account is unavailable.')
    expect(requests()).toBe(0)
  })

  it('titles the page "XClone user"', async () => {
    open()
    await screen.findByText('This account is unavailable.')
    expect(document.title).toBe('XClone user / XClone')
  })
})

describe('lists', () => {
  it('a deactivated follower is a plain "XClone user" row: no handle, nothing to open', async () => {
    server.use(
      http.get(`${BASE}/api/users/bob`, () => HttpResponse.json(makeProfile())),
      http.get(`${BASE}/api/users/bob/followers`, () => page([makeUser({ id: 21, username: 'real_fan', displayName: 'Real Fan' }), ghost()])),
    )
    renderSignedIn(<Routes><Route path="/u/:username/followers" element={<FollowListPage kind="followers" />} /></Routes>, { route: '/u/bob/followers' })

    expect(await screen.findByRole('link', { name: /Real Fan/ })).toHaveAttribute('href', '/u/real_fan')
    const row = screen.getByText('XClone user')
    expect(row.closest('a')).toBeNull()
    expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).not.toContain('/u/') // no link built from an empty handle
    expect(screen.queryByText(/^@$/)).not.toBeInTheDocument()
  })
})

describe('posts', () => {
  it('a mention of a deactivated account is plain text, not a link', async () => {
    server.use(http.get(`${BASE}/api/users/me`, () => HttpResponse.json(me)))
    renderSignedIn(<PostCard post={makePost({ content: 'thanks @old_name and @real_one', mentions: [ghost(), makeUser({ username: 'real_one' })] })} />, { route: '/' })

    expect(await screen.findByRole('link', { name: '@real_one' })).toHaveAttribute('href', '/u/real_one')
    expect(screen.queryByRole('link', { name: '@old_name' })).not.toBeInTheDocument()
    expect(screen.getByText(/thanks @old_name and/)).toBeInTheDocument() // the other person's words stay as they wrote them
  })
})

describe('messages with a deactivated account', () => {
  const conversation: ConversationResponse = {
    id: 5, participant: ghost(), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    lastMessage: { id: 9, senderId: 77, content: 'last words', createdAt: '2026-01-01T00:00:00Z', deleted: false }, unreadCount: 1,
  }
  const history: MessageResponse[] = [
    { id: 8, conversationId: 5, sender: ghost(), content: 'hello from before', createdAt: '2026-01-01T00:00:00Z', editedAt: null, deleted: false },
    { id: 9, conversationId: 5, sender: { id: me.id, username: me.username, displayName: me.displayName, avatarUrl: null, protectedAccount: false }, content: 'my answer', createdAt: '2026-01-01T00:01:00Z', editedAt: null, deleted: false },
  ]

  it('the inbox row says "XClone user", with no handle, and still opens', async () => {
    renderSignedIn(<ConversationRow conversation={conversation} />, { route: '/' })

    const row = await screen.findByRole('link', { name: 'Conversation with XClone user, 1 unread' })
    expect(row).toHaveAttribute('href', '/messages/5')
    expect(row).not.toHaveTextContent('@')
  })

  it('the chat keeps the history, has no profile link, and cannot be written to or changed', async () => {
    server.use(
      http.get(`${BASE}/api/conversations/5`, () => HttpResponse.json(conversation)),
      http.get(`${BASE}/api/conversations/5/messages`, () => HttpResponse.json({ items: history, nextCursor: null })),
      http.post(`${BASE}/api/conversations/5/read`, () => new HttpResponse(null, { status: 204 })),
    )
    renderSignedIn(<Routes><Route path="/messages/:id" element={<ChatPage />} /></Routes>, { route: '/messages/5' })

    expect(await screen.findByText('hello from before')).toBeInTheDocument()
    expect(screen.getByText('my answer')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'XClone user' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /profile/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent("You can't reply to this conversation: this account is unavailable.")
    expect(screen.queryByRole('button', { name: 'Message actions' })).not.toBeInTheDocument() // even my own messages cannot be edited or deleted
    await waitFor(() => expect(within(document.body).queryByText('@')).not.toBeInTheDocument())
  })

  it('a normal chat still has the writing box and the message menu', async () => {
    const normal: ConversationResponse = { ...conversation, participant: makeUser({ id: 80, username: 'carol', displayName: 'Carol' }) }
    server.use(
      http.get(`${BASE}/api/conversations/5`, () => HttpResponse.json(normal)),
      http.get(`${BASE}/api/conversations/5/messages`, () => HttpResponse.json({ items: history.map((m) => (m.id === 8 ? { ...m, sender: normal.participant } : m)), nextCursor: null })),
      http.post(`${BASE}/api/conversations/5/read`, () => new HttpResponse(null, { status: 204 })),
    )
    renderSignedIn(<Routes><Route path="/messages/:id" element={<ChatPage />} /></Routes>, { route: '/messages/5' })

    expect(await screen.findByRole('textbox', { name: 'Message' })).toBeInTheDocument()
    expect(await screen.findAllByRole('button', { name: 'Message actions' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: "Carol's profile" })).toHaveAttribute('href', '/u/carol')
  })
})
