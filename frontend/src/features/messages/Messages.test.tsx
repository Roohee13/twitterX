import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { ConversationResponse, MessageResponse, UserSummary } from '../../lib/types'
import { fakeSocket } from '../../test/fakeSocket'
import { makeProfile, makeUser } from '../../test/fixtures'
import { BASE, me, renderSignedIn, server } from '../../test/render'
import { LiveSocketContext } from '../notifications/liveSocketContext'
import { ProfileHeader } from '../profile/ProfileHeader'
import { ChatPage } from './ChatPage'
import { useLiveMessages, useUnreadMessages } from './messageHooks'
import { MessagesPage } from './MessagesPage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const dana = makeUser({ id: 31, username: 'dana', displayName: 'Dana Dev' })
const eli = makeUser({ id: 32, username: 'eli', displayName: 'Eli Eng' })
const meSummary = makeUser({ id: me.id, username: me.username, displayName: me.displayName })

let nextMessageId = 100
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const message = (conversationId: number, from: 'me' | 'them', content: string, overrides: Partial<MessageResponse> = {}): MessageResponse => ({
  id: nextMessageId++, conversationId, sender: from === 'me' ? meSummary : dana, content, createdAt: minutesAgo(5), editedAt: null, deleted: false, ...overrides,
})
/** One page of a thread the way the API serves it: the latest messages first, each page ordered oldest to newest, `nextCursor` = the oldest id on the page. */
function pageOf(oldestFirst: MessageResponse[], cursor: number, limit: number) {
  const older = oldestFirst.filter((m) => m.id < cursor)
  const items = older.slice(-limit)
  return { items, nextCursor: older.length > limit ? items[0].id : null }
}

const conversation = (id: number, participant = dana, overrides: Partial<ConversationResponse> = {}): ConversationResponse => ({
  id, participant, createdAt: minutesAgo(60), updatedAt: minutesAgo(5), lastMessage: null, unreadCount: 0, ...overrides,
})

/** A fake server with conversations and their messages; sending, reading and the unread total behave like the real one. */
function serve(initial: { conversations: ConversationResponse[]; messages?: Record<number, MessageResponse[]> }) {
  const state = {
    conversations: [...initial.conversations],
    messages: { ...(initial.messages ?? {}) } as Record<number, MessageResponse[]>, // oldest first
    sent: [] as Array<{ conversationId: number; content: string }>,
    read: [] as number[],
    started: [] as string[],
    failNextSend: null as string | null,
    /** Milliseconds a message with this text takes to be saved, to make slow requests overtake each other. */
    sendDelay: {} as Record<string, number>,
    edits: [] as Array<{ id: number; content: string }>,
    deletedConversations: [] as number[],
    deletes: [] as number[],
    failNextChange: null as string | null,
  }
  const inboxRows = () => state.conversations.filter((c) => c.lastMessage).sort((a, b) => b.lastMessage!.id - a.lastMessage!.id)
  server.use(
    http.get(`${BASE}/api/conversations/unread-count`, () => HttpResponse.json({ count: state.conversations.reduce((n, c) => n + c.unreadCount, 0) })),
    http.get(`${BASE}/api/conversations`, () => HttpResponse.json({ items: inboxRows(), nextCursor: null })),
    http.post(`${BASE}/api/conversations`, async ({ request }) => {
      const { username } = (await request.json()) as { username: string }
      state.started.push(username)
      const found = state.conversations.find((c) => c.participant.username === username)
      if (found) return HttpResponse.json(found)
      if (username === 'blocked_one') return HttpResponse.json({ status: 403, detail: 'You cannot message this user' }, { status: 403 })
      const created = conversation(900, makeUser({ id: 50, username, displayName: 'Brand New' }))
      state.conversations.push(created)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.get(`${BASE}/api/conversations/:id`, ({ params }) => {
      const found = state.conversations.find((c) => c.id === Number(params.id))
      return found ? HttpResponse.json(found) : HttpResponse.json({ status: 404, detail: 'Conversation not found' }, { status: 404 })
    }),
    http.get(`${BASE}/api/conversations/:id/messages`, ({ params, request }) => {
      const url = new URL(request.url)
      const cursor = Number(url.searchParams.get('cursor') ?? Number.MAX_SAFE_INTEGER)
      const limit = Number(url.searchParams.get('limit') ?? 20)
      return HttpResponse.json(pageOf(state.messages[Number(params.id)] ?? [], cursor, limit))
    }),
    http.post(`${BASE}/api/conversations/:id/messages`, async ({ params, request }) => {
      const { content } = (await request.json()) as { content: string }
      const id = Number(params.id)
      if (state.sendDelay[content]) await new Promise((r) => setTimeout(r, state.sendDelay[content]))
      if (state.failNextSend) {
        const detail = state.failNextSend
        state.failNextSend = null
        return HttpResponse.json({ status: 403, detail }, { status: 403 })
      }
      state.sent.push({ conversationId: id, content })
      const saved = message(id, 'me', content, { createdAt: new Date().toISOString() })
      state.messages[id] = [...(state.messages[id] ?? []), saved]
      state.conversations = state.conversations.map((c) => (c.id === id ? { ...c, lastMessage: { id: saved.id, senderId: me.id, content, createdAt: saved.createdAt, deleted: false } } : c))
      return HttpResponse.json(saved, { status: 201 })
    }),
    http.patch(`${BASE}/api/conversations/:id/messages/:messageId`, async ({ params, request }) => {
      if (state.failNextChange) {
        const detail = state.failNextChange
        state.failNextChange = null
        return HttpResponse.json({ status: 403, detail }, { status: 403 })
      }
      const { content } = (await request.json()) as { content: string }
      const list = state.messages[Number(params.id)] ?? []
      const found = list.find((m) => m.id === Number(params.messageId))
      if (!found) return HttpResponse.json({ status: 404, detail: 'Message not found' }, { status: 404 })
      state.edits.push({ id: found.id, content })
      Object.assign(found, { content, editedAt: new Date().toISOString() })
      return HttpResponse.json(found)
    }),
    http.delete(`${BASE}/api/conversations/:id/messages/:messageId`, ({ params }) => {
      if (state.failNextChange) {
        const detail = state.failNextChange
        state.failNextChange = null
        return HttpResponse.json({ status: 403, detail }, { status: 403 })
      }
      const found = (state.messages[Number(params.id)] ?? []).find((m) => m.id === Number(params.messageId))
      if (!found) return HttpResponse.json({ status: 404, detail: 'Message not found' }, { status: 404 })
      state.deletes.push(found.id)
      Object.assign(found, { content: '', deleted: true })
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete(`${BASE}/api/conversations/:id`, ({ params }) => {
      if (state.failNextChange) {
        const detail = state.failNextChange
        state.failNextChange = null
        return HttpResponse.json({ status: 500, detail }, { status: 500 })
      }
      state.deletedConversations.push(Number(params.id))
      state.conversations = state.conversations.filter((c) => c.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${BASE}/api/conversations/:id/read`, ({ params }) => {
      state.read.push(Number(params.id))
      state.conversations = state.conversations.map((c) => (c.id === Number(params.id) ? { ...c, unreadCount: 0 } : c))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return state
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}</p>
}
function Shell({ children }: { children: React.ReactNode }) {
  useLiveMessages()
  const unread = useUnreadMessages()
  return <><p data-testid="badge">{unread.data ?? '-'}</p>{children}</>
}

function open(route: string, state = serve({ conversations: [] })) {
  const live = fakeSocket()
  renderSignedIn(
    <LiveSocketContext.Provider value={live.socket}>
      <Shell>
        <Routes>
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/messages/:id" element={<ChatPage />} />
        </Routes>
        <Where />
      </Shell>
    </LiveSocketContext.Provider>,
    { route },
  )
  return { state, live }
}
const PUSH = '/user/queue/messages'
const UPDATES = '/user/queue/message-updates'
const textbox = () => screen.getByRole('textbox', { name: 'Message' })

describe('the inbox', () => {
  it('lists conversations most recent first, with the preview, who wrote it and the unread count', async () => {
    const state = serve({
      conversations: [
        conversation(1, dana, { lastMessage: { id: 10, senderId: dana.id, content: 'see you tomorrow', createdAt: minutesAgo(3), deleted: false }, unreadCount: 2 }),
        conversation(2, eli, { lastMessage: { id: 20, senderId: me.id, content: 'sounds good', createdAt: minutesAgo(30), deleted: false } }),
      ],
    })
    open('/messages', state)

    const rows = await screen.findAllByRole('link', { name: /Conversation with/ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Conversation with Eli Eng', 'Conversation with Dana Dev, 2 unread']) // Eli's last message has the higher id
    expect(rows[0]).toHaveTextContent('You: sounds good')
    expect(rows[0]).toHaveAttribute('href', '/messages/2')
    expect(rows[1]).toHaveTextContent('see you tomorrow')
    expect(rows[1]).toHaveTextContent('2')
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('2'))
  })

  it('says when there is nothing yet', async () => {
    open('/messages')
    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
  })

  it('"New message" finds people and opens a conversation with the one you pick', async () => {
    const state = serve({ conversations: [] })
    server.use(http.get(`${BASE}/api/users/search`, () => HttpResponse.json([makeUser({ id: 40, username: 'newbie', displayName: 'Nina Newbie' })])))
    open('/messages', state)

    await userEvent.click(await screen.findByRole('button', { name: /New message/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New message' })
    await userEvent.type(within(dialog).getByLabelText('Search people'), 'nin')
    await userEvent.click(await within(dialog).findByRole('button', { name: /Nina Newbie/ }))

    await waitFor(() => expect(state.started).toEqual(['newbie']))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/messages/900'))
  })

  it('shows why a conversation could not be started and stays where it is', async () => {
    const state = serve({ conversations: [] })
    server.use(http.get(`${BASE}/api/users/search`, () => HttpResponse.json([makeUser({ id: 41, username: 'blocked_one', displayName: 'Blocked One' })])))
    open('/messages', state)

    await userEvent.click(await screen.findByRole('button', { name: /New message/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New message' })
    await userEvent.type(within(dialog).getByLabelText('Search people'), 'blo')
    await userEvent.click(await within(dialog).findByRole('button', { name: /Blocked One/ }))

    expect(await screen.findByText('You cannot message this user')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/messages')
    expect(screen.getByTestId('where')).not.toHaveTextContent('/messages/')
  })
})

describe('a conversation', () => {
  const thread = (n: number) => Array.from({ length: n }, (_, i) => message(1, i % 2 === 0 ? 'them' : 'me', `message ${i + 1}`, { createdAt: minutesAgo(n - i) }))

  it('shows the messages oldest to newest, mine and theirs apart, under their name', async () => {
    const state = serve({ conversations: [conversation(1)], messages: { 1: [message(1, 'them', 'hello there'), message(1, 'me', 'hi dana')] } })
    open('/messages/1', state)

    expect(await screen.findByRole('heading', { name: 'Dana Dev' })).toBeInTheDocument()
    const bubbles = await screen.findAllByText(/hello there|hi dana/)
    expect(bubbles.map((b) => b.textContent)).toEqual(['hello there', 'hi dana'])
    expect(screen.getByRole('link', { name: "Dana Dev's profile" })).toHaveAttribute('href', '/u/dana')
    expect(screen.getByRole('link', { name: 'Back to messages' })).toHaveAttribute('href', '/messages')
  })

  it('keeps the conversation in order, oldest at the top and the newest right above the writing box, also after sending and receiving', async () => {
    const state = serve({
      conversations: [conversation(1)],
      messages: { 1: [message(1, 'them', 'first', { createdAt: minutesAgo(30) }), message(1, 'me', 'second', { createdAt: minutesAgo(20) }), message(1, 'them', 'third', { createdAt: minutesAgo(10) }), message(1, 'me', 'fourth', { createdAt: minutesAgo(5) })] },
    })
    const { live } = open('/messages/1', state)
    const order = () => screen.getAllByText(/^(first|second|third|fourth|fifth|sixth)$/).map((b) => b.textContent)
    await screen.findByText('fourth')
    expect(order()).toEqual(['first', 'second', 'third', 'fourth'])

    await userEvent.type(textbox(), 'fifth{Enter}') // sent by me
    await screen.findByText('fifth')
    expect(order()).toEqual(['first', 'second', 'third', 'fourth', 'fifth'])
    await waitFor(() => expect(screen.queryByText('Sending…')).not.toBeInTheDocument())
    expect(order()).toEqual(['first', 'second', 'third', 'fourth', 'fifth'])

    await waitFor(() => expect(live.subscribed(PUSH)).toBe(1))
    const pushed = message(1, 'them', 'sixth', { createdAt: new Date().toISOString() })
    state.messages[1].push(pushed)
    await live.push(PUSH, pushed) // received
    await screen.findByText('sixth')
    await waitFor(() => expect(order()).toEqual(['first', 'second', 'third', 'fourth', 'fifth', 'sixth']))
  })

  it('invites you to say hello when there are no messages', async () => {
    open('/messages/1', serve({ conversations: [conversation(1)] }))
    expect(await screen.findByText(/Say hello to Dana Dev/)).toBeInTheDocument()
  })

  it('loads older messages on request and keeps the order', async () => {
    const state = serve({ conversations: [conversation(1)], messages: { 1: thread(45) } })
    open('/messages/1', state)
    await screen.findByText('message 45')
    expect(screen.queryByText('message 10')).not.toBeInTheDocument() // only the newest 30 so far

    await userEvent.click(screen.getByRole('button', { name: 'Load older messages' }))

    await screen.findByText('message 1')
    const texts = screen.getAllByText(/^message \d+$/).map((b) => b.textContent)
    expect(texts).toEqual(Array.from({ length: 45 }, (_, i) => `message ${i + 1}`))
    expect(screen.queryByRole('button', { name: 'Load older messages' })).not.toBeInTheDocument()
  })

  it('Enter sends and clears the box; the message shows up and the server got exactly that text', async () => {
    const state = serve({ conversations: [conversation(1)] })
    open('/messages/1', state)
    await screen.findByText(/Say hello/)

    await userEvent.type(textbox(), 'hello dana{Enter}')

    expect(await screen.findByText('hello dana')).toBeInTheDocument()
    expect(textbox()).toHaveValue('')
    await waitFor(() => expect(state.sent).toEqual([{ conversationId: 1, content: 'hello dana' }]))
    await waitFor(() => expect(screen.queryByText('Sending…')).not.toBeInTheDocument())
    expect(screen.getAllByText('hello dana')).toHaveLength(1) // not twice once it is saved
  })

  it('Shift+Enter makes a new line instead of sending; blank messages are not sent', async () => {
    const state = serve({ conversations: [conversation(1)] })
    open('/messages/1', state)
    await screen.findByText(/Say hello/)

    await userEvent.type(textbox(), 'line one{Shift>}{Enter}{/Shift}line two')
    expect(textbox()).toHaveValue('line one\nline two')
    expect(state.sent).toEqual([])

    await userEvent.clear(textbox())
    await userEvent.type(textbox(), '   {Enter}')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    expect(state.sent).toEqual([])
  })

  it('several quick messages arrive in the order they were written', async () => {
    const state = serve({ conversations: [conversation(1)] })
    state.sendDelay = { one: 100 } // the first one is slow: without taking turns the others would overtake it
    open('/messages/1', state)
    await screen.findByText(/Say hello/)

    await userEvent.type(textbox(), 'one{Enter}two{Enter}three{Enter}')

    await waitFor(() => expect(state.sent.map((s) => s.content)).toEqual(['one', 'two', 'three']))
    await waitFor(() => expect(screen.queryByText('Sending…')).not.toBeInTheDocument())
    expect(screen.getAllByText(/^(one|two|three)$/).map((b) => b.textContent)).toEqual(['one', 'two', 'three'])
  })

  it('a message that fails shows the reason, and Retry sends it again', async () => {
    const state = serve({ conversations: [conversation(1)] })
    open('/messages/1', state)
    await screen.findByText(/Say hello/)
    state.failNextSend = 'This user cannot receive messages'

    await userEvent.type(textbox(), 'are you there?{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This user cannot receive messages')
    expect(state.sent).toEqual([])
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(state.sent).toEqual([{ conversationId: 1, content: 'are you there?' }]))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('a failed message can be discarded', async () => {
    const state = serve({ conversations: [conversation(1)] })
    open('/messages/1', state)
    await screen.findByText(/Say hello/)
    state.failNextSend = 'Nope'
    await userEvent.type(textbox(), 'oops{Enter}')

    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))

    expect(screen.queryByText('oops')).not.toBeInTheDocument()
    expect(state.sent).toEqual([])
  })

  it('explains why a conversation cannot be opened', async () => {
    open('/messages/77', serve({ conversations: [] }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Conversation not found')
    expect(screen.getByRole('link', { name: 'Back to messages' })).toBeInTheDocument()
  })

  it('opening it with unread messages marks them read, and the total drops', async () => {
    const state = serve({ conversations: [conversation(1, dana, { unreadCount: 3, lastMessage: { id: 5, senderId: dana.id, content: 'hey', createdAt: minutesAgo(1), deleted: false } })], messages: { 1: [message(1, 'them', 'hey')] } })
    open('/messages/1', state)
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('3'))

    await waitFor(() => expect(state.read).toEqual([1]))
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('0'))
  })
})

describe('live messages', () => {
  it('a message pushed into the open conversation appears at the bottom and is read at once', async () => {
    const state = serve({ conversations: [conversation(1)], messages: { 1: [message(1, 'me', 'earlier')] } })
    const { live } = open('/messages/1', state)
    await screen.findByText('earlier')
    await waitFor(() => expect(live.subscribed(PUSH)).toBe(1))
    const pushed = message(1, 'them', 'just now!', { createdAt: new Date().toISOString() })
    state.messages[1].push(pushed)
    state.conversations = [conversation(1, dana, { unreadCount: 1, lastMessage: { id: pushed.id, senderId: dana.id, content: pushed.content, createdAt: pushed.createdAt, deleted: false } })]

    await live.push(PUSH, pushed)

    expect(await screen.findByText('just now!')).toBeInTheDocument()
    await waitFor(() => expect(state.read).toContain(1))
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('0'))
  })

  it('a message pushed while looking at the inbox moves that conversation to the top and raises the count', async () => {
    const state = serve({
      conversations: [
        conversation(1, dana, { lastMessage: { id: 10, senderId: dana.id, content: 'older chat', createdAt: minutesAgo(60), deleted: false } }),
        conversation(2, eli, { lastMessage: { id: 20, senderId: eli.id, content: 'newer chat', createdAt: minutesAgo(10), deleted: false } }),
      ],
    })
    const { live } = open('/messages', state)
    await screen.findByRole('link', { name: 'Conversation with Eli Eng' })
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('0'))
    const pushed = message(1, 'them', 'psst, new message', { id: 30, createdAt: new Date().toISOString() })
    state.conversations = state.conversations.map((c) => (c.id === 1 ? { ...c, unreadCount: 1, lastMessage: { id: 30, senderId: dana.id, content: pushed.content, createdAt: pushed.createdAt, deleted: false } } : c))

    await live.push(PUSH, pushed)

    await waitFor(() => expect(screen.getAllByRole('link', { name: /Conversation with/ })[0]).toHaveAccessibleName('Conversation with Dana Dev, 1 unread'))
    expect(screen.getAllByRole('link', { name: /Conversation with/ })[0]).toHaveTextContent('psst, new message')
    expect(screen.getByTestId('badge')).toHaveTextContent('1')
  })

  it('after the connection comes up it reads the real state, so messages from before are not missed', async () => {
    const state = serve({ conversations: [] })
    const { live } = open('/messages', state)
    await screen.findByText('No messages yet')
    state.conversations = [conversation(1, dana, { unreadCount: 2, lastMessage: { id: 5, senderId: dana.id, content: 'sent while connecting', createdAt: minutesAgo(1), deleted: false } })]

    await live.connect()

    expect(await screen.findByRole('link', { name: 'Conversation with Dana Dev, 2 unread' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('2'))
  })

  it('a message pushed while the conversation is still loading is not lost', async () => {
    const state = serve({ conversations: [conversation(1)], messages: { 1: [message(1, 'me', 'earlier')] } })
    const stale = [...state.messages[1]]
    let calls = 0
    server.use(http.get(`${BASE}/api/conversations/1/messages`, async () => {
      calls += 1
      const first = calls === 1
      await new Promise((r) => setTimeout(r, first ? 100 : 0)) // the first answer was prepared before the message existed
      return HttpResponse.json(pageOf(first ? stale : state.messages[1], Number.MAX_SAFE_INTEGER, 30))
    }))
    const { live } = open('/messages/1', state)
    await waitFor(() => expect(live.subscribed(PUSH)).toBe(1))
    await waitFor(() => expect(calls).toBe(1)) // the thread is loading right now
    const pushed = message(1, 'them', 'arrived during the load', { createdAt: new Date().toISOString() })
    state.messages[1].push(pushed)

    await live.push(PUSH, pushed)

    expect(await screen.findByText('arrived during the load')).toBeInTheDocument()
  })

  it('an older answer that arrives after a push does not wipe the message out', async () => {
    const state = serve({ conversations: [conversation(1)], messages: { 1: [message(1, 'me', 'earlier')] } })
    const { live } = open('/messages/1', state)
    await screen.findByText('earlier')
    await waitFor(() => expect(live.subscribed(PUSH)).toBe(1))
    const stale = [...state.messages[1]]
    let slow = true
    server.use(http.get(`${BASE}/api/conversations/1/messages`, async () => {
      if (slow) await new Promise((r) => setTimeout(r, 120))
      return HttpResponse.json(pageOf(slow ? stale : state.messages[1], Number.MAX_SAFE_INTEGER, 30))
    }))
    await live.connect() // a catch-up read starts, answered with the state from before the push
    const pushed = message(1, 'them', 'arrived meanwhile', { createdAt: new Date().toISOString() })
    state.messages[1].push(pushed)

    await live.push(PUSH, pushed)
    slow = false
    await new Promise((r) => setTimeout(r, 250))

    expect(screen.getByText('arrived meanwhile')).toBeInTheDocument()
  })
})

describe('messaging from a profile', () => {
  function openProfile(profile = makeProfile({ id: 31, username: 'dana', displayName: 'Dana Dev' }), state = serve({ conversations: [conversation(1)] })) {
    renderSignedIn(
      <>
        <Routes>
          <Route path="/u/:username" element={<ProfileHeader profile={profile} onEdit={() => undefined} />} />
          <Route path="/messages/:id" element={<p>the chat</p>} />
        </Routes>
        <Where />
      </>,
      { route: '/u/dana' },
    )
    return state
  }

  it('has a Message button that opens the conversation', async () => {
    const state = openProfile()
    await userEvent.click(await screen.findByRole('button', { name: 'Message Dana Dev' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/messages/1'))
    expect(state.started).toEqual(['dana'])
  })

  it('is not offered for someone you blocked, or on your own profile', async () => {
    openProfile(makeProfile({ id: 31, username: 'dana', displayName: 'Dana Dev', blockedByMe: true }))
    await screen.findByRole('heading', { name: /Dana Dev/ })
    expect(screen.queryByRole('button', { name: /^Message/ })).not.toBeInTheDocument()
  })

  it('tells you why when the other person cannot be messaged', async () => {
    const state = openProfile(makeProfile({ id: 41, username: 'blocked_one', displayName: 'Blocked One' }))
    expect(state.started).toEqual([])
    await userEvent.click(await screen.findByRole('button', { name: 'Message Blocked One' }))
    expect(await screen.findByText('You cannot message this user')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/u/dana')
  })
})

describe('editing and deleting messages', () => {
  const chat = () => serve({
    conversations: [conversation(1)],
    messages: { 1: [message(1, 'them', 'hello from them', { createdAt: minutesAgo(10) }), message(1, 'me', 'my first message', { createdAt: minutesAgo(5) })] },
  })
  const menuOf = (text: string) => within(screen.getByText(text).closest('div.group') as HTMLElement).getByRole('button', { name: 'Message actions' })

  it('only your own messages have the menu', async () => {
    open('/messages/1', chat())
    await screen.findByText('my first message')
    expect(menuOf('my first message')).toBeInTheDocument()
    expect(within(screen.getByText('hello from them').closest('div.group') as HTMLElement).queryByRole('button', { name: 'Message actions' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Message actions' })).toHaveLength(1)
  })

  it('edits in place: the box starts with the text, Enter saves exactly the new text, and the message is marked "edited"', async () => {
    const state = chat()
    open('/messages/1', state)
    await screen.findByText('my first message')

    await userEvent.click(menuOf('my first message'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const box = await screen.findByRole('textbox', { name: 'Edit message' })
    expect(box).toHaveValue('my first message')
    await userEvent.clear(box)
    await userEvent.type(box, 'my corrected message{Enter}')

    expect(await screen.findByText('my corrected message')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument()
    expect(screen.queryByText('my first message')).not.toBeInTheDocument()
    expect(state.edits).toEqual([{ id: state.messages[1][1].id, content: 'my corrected message' }])
    expect(screen.getByText(/· edited/)).toBeInTheDocument()
    expect(screen.getAllByText(/· edited/)).toHaveLength(1) // only the one that was changed
  })

  it('Escape or Cancel leaves it as it was, and saving unchanged text sends nothing', async () => {
    const state = chat()
    open('/messages/1', state)
    await screen.findByText('my first message')

    await userEvent.click(menuOf('my first message'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Edit message' }), ' extra{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument()
    expect(screen.getByText('my first message')).toBeInTheDocument()

    await userEvent.click(menuOf('my first message'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument()

    await userEvent.click(menuOf('my first message'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Edit message' }), '{Enter}') // nothing changed
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument()
    expect(state.edits).toEqual([])
  })

  it('will not save an empty message, and shows the server\'s reason while keeping what you typed', async () => {
    const state = chat()
    open('/messages/1', state)
    await screen.findByText('my first message')
    await userEvent.click(menuOf('my first message'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const box = await screen.findByRole('textbox', { name: 'Edit message' })

    await userEvent.clear(box)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(box, '   {Enter}')
    expect(await screen.findByText('A message cannot be empty')).toBeInTheDocument()
    expect(state.edits).toEqual([])

    await userEvent.clear(box)
    await userEvent.type(box, 'new words')
    state.failNextChange = 'This user cannot receive messages'
    await userEvent.type(box, '{Enter}')

    expect(await screen.findByText('This user cannot receive messages')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toHaveValue('new words')
  })

  it('asks before deleting; cancelling keeps the message', async () => {
    const state = chat()
    open('/messages/1', state)
    await screen.findByText('my first message')
    await userEvent.click(menuOf('my first message'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this message?' })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(state.deletes).toEqual([])
    expect(screen.getByText('my first message')).toBeInTheDocument()
  })

  it('deletes for both: the text is replaced by a note, which has no menu', async () => {
    const state = chat()
    open('/messages/1', state)
    await screen.findByText('my first message')
    await userEvent.click(menuOf('my first message'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete this message?' })).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('You deleted this message')).toBeInTheDocument()
    expect(screen.queryByText('my first message')).not.toBeInTheDocument()
    expect(state.deletes).toEqual([state.messages[1][1].id])
    expect(screen.queryByRole('button', { name: 'Message actions' })).not.toBeInTheDocument()
    expect(screen.getByText('hello from them')).toBeInTheDocument() // the rest is untouched
  })

  it('keeps the message and says why when deleting fails', async () => {
    const state = chat()
    open('/messages/1', state)
    await screen.findByText('my first message')
    await userEvent.click(menuOf('my first message'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    state.failNextChange = 'Message not available right now'
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete this message?' })).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Message not available right now')).toBeInTheDocument()
    expect(screen.getByText('my first message')).toBeInTheDocument()
  })

  it('shows deleted messages from the other person as a note, from the start', async () => {
    open('/messages/1', serve({ conversations: [conversation(1)], messages: { 1: [message(1, 'them', '', { deleted: true }), message(1, 'me', 'still here')] } }))
    expect(await screen.findByText('This message was deleted')).toBeInTheDocument()
    expect(screen.getByText('still here')).toBeInTheDocument()
  })

  it('an edit or delete pushed by the other person replaces the message instead of adding one', async () => {
    const state = chat()
    const { live } = open('/messages/1', state)
    await screen.findByText('hello from them')
    await waitFor(() => expect(live.subscribed(UPDATES)).toBe(1))
    const theirs = state.messages[1][0]

    Object.assign(theirs, { content: 'hello again, corrected', editedAt: new Date().toISOString() })
    await live.push(UPDATES, { ...theirs })
    expect(await screen.findByText('hello again, corrected')).toBeInTheDocument()
    expect(screen.queryByText('hello from them')).not.toBeInTheDocument()
    expect(screen.getAllByText(/^(hello again, corrected|my first message)$/)).toHaveLength(2) // no extra bubble
    expect(screen.getByText(/· edited/)).toBeInTheDocument()

    Object.assign(theirs, { content: '', deleted: true })
    await live.push(UPDATES, { ...theirs })
    expect(await screen.findByText('This message was deleted')).toBeInTheDocument()
    expect(screen.queryByText('hello again, corrected')).not.toBeInTheDocument()
  })

  it('the inbox shows what became of the last message, and its unread count follows the deletion', async () => {
    const state = serve({
      conversations: [
        conversation(1, dana, { unreadCount: 2, lastMessage: { id: 10, senderId: dana.id, content: 'second', createdAt: minutesAgo(1), deleted: false } }),
        conversation(2, eli, { lastMessage: { id: 20, senderId: me.id, content: '', createdAt: minutesAgo(30), deleted: true } }),
      ],
    })
    const { live } = open('/messages', state)
    const rows = await screen.findAllByRole('link', { name: /Conversation with/ })
    expect(rows[0]).toHaveAccessibleName('Conversation with Eli Eng')
    expect(rows[0]).toHaveTextContent('You deleted a message')
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('2'))
    await waitFor(() => expect(live.subscribed(UPDATES)).toBe(1))

    // Dana deletes her newest message: it no longer counts as unread, and the preview says so.
    state.conversations = state.conversations.map((c) => (c.id === 1 ? { ...c, unreadCount: 1, lastMessage: { ...c.lastMessage!, content: '', deleted: true } } : c))
    await live.push(UPDATES, message(1, 'them', '', { id: 10, deleted: true }))

    await waitFor(() => expect(screen.getByRole('link', { name: 'Conversation with Dana Dev, 1 unread' })).toHaveTextContent('This message was deleted'))
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('1'))
  })
})

describe('deleting a conversation', () => {
  const withLast = (id: number, who = dana, unread = 0) => conversation(id, who, { unreadCount: unread, lastMessage: { id: id * 10, senderId: who.id, content: `last of ${id}`, createdAt: minutesAgo(1), deleted: false } })
  const menu = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Conversation actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete conversation' }))
    return screen.findByRole('dialog', { name: 'Delete this conversation?' })
  }

  it('asks first, explains that the other person keeps theirs, and cancelling changes nothing', async () => {
    const state = serve({ conversations: [withLast(1)], messages: { 1: [message(1, 'them', 'keep me')] } })
    open('/messages/1', state)
    await screen.findByText('keep me')

    const dialog = await menu()

    expect(dialog).toHaveTextContent('Dana Dev keeps their copy and is not told')
    expect(dialog).toHaveTextContent('comes back with only the new messages')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(state.deletedConversations).toEqual([])
    expect(screen.getByText('keep me')).toBeInTheDocument()
  })

  it('deletes it, goes back to the inbox, says so, and the conversation is gone from the list', async () => {
    const state = serve({ conversations: [withLast(1), withLast(2, eli)], messages: { 1: [message(1, 'them', 'bye')] } })
    open('/messages/1', state)
    await screen.findByText('bye')

    await userEvent.click(within(await menu()).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/messages$/))
    expect(await screen.findByText('Conversation deleted.')).toBeInTheDocument()
    expect(state.deletedConversations).toEqual([1])
    expect(await screen.findByRole('link', { name: 'Conversation with Eli Eng' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Conversation with Dana Dev' })).not.toBeInTheDocument())
  })

  it('what the conversation held as unread leaves the badge', async () => {
    const state = serve({ conversations: [withLast(1, dana, 3), withLast(2, eli, 1)], messages: { 1: [message(1, 'them', 'unread one')] } })
    open('/messages/1', state)
    await screen.findByText('unread one')

    await userEvent.click(within(await menu()).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('1')) // only Eli's one is left
  })

  it('stays in the chat and shows the reason when it cannot be deleted', async () => {
    const state = serve({ conversations: [withLast(1)], messages: { 1: [message(1, 'them', 'still here')] } })
    open('/messages/1', state)
    await screen.findByText('still here')
    const dialog = await menu()
    state.failNextChange = 'The server is busy'

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('The server is busy')).toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/messages/1')
    expect(screen.getByText('still here')).toBeInTheDocument()
  })

  it('is still offered when the other account is unavailable (a read-only chat)', async () => {
    const state = serve({ conversations: [conversation(1, { ...dana, username: '', displayName: 'XClone user', unavailable: true } as UserSummary, { lastMessage: { id: 10, senderId: dana.id, content: 'old', createdAt: minutesAgo(1), deleted: false } })], messages: { 1: [message(1, 'them', 'old')] } })
    open('/messages/1', state)
    await screen.findByText('old')

    await userEvent.click(within(await menu()).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(state.deletedConversations).toEqual([1]))
  })
})
