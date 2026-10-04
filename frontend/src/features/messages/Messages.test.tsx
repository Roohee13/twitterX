import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { ConversationResponse, MessageResponse } from '../../lib/types'
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
  id: nextMessageId++, conversationId, sender: from === 'me' ? meSummary : dana, content, createdAt: minutesAgo(5), ...overrides,
})
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
      const all = [...(state.messages[Number(params.id)] ?? [])].reverse() // newest first
      const url = new URL(request.url)
      const cursor = Number(url.searchParams.get('cursor') ?? Number.MAX_SAFE_INTEGER)
      const limit = Number(url.searchParams.get('limit') ?? 20)
      const rest = all.filter((m) => m.id < cursor)
      const items = rest.slice(0, limit)
      return HttpResponse.json({ items, nextCursor: rest.length > limit ? items.at(-1)!.id : null })
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
      state.conversations = state.conversations.map((c) => (c.id === id ? { ...c, lastMessage: { id: saved.id, senderId: me.id, content, createdAt: saved.createdAt } } : c))
      return HttpResponse.json(saved, { status: 201 })
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
const textbox = () => screen.getByRole('textbox', { name: 'Message' })

describe('the inbox', () => {
  it('lists conversations most recent first, with the preview, who wrote it and the unread count', async () => {
    const state = serve({
      conversations: [
        conversation(1, dana, { lastMessage: { id: 10, senderId: dana.id, content: 'see you tomorrow', createdAt: minutesAgo(3) }, unreadCount: 2 }),
        conversation(2, eli, { lastMessage: { id: 20, senderId: me.id, content: 'sounds good', createdAt: minutesAgo(30) } }),
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
    const state = serve({ conversations: [conversation(1, dana, { unreadCount: 3, lastMessage: { id: 5, senderId: dana.id, content: 'hey', createdAt: minutesAgo(1) } })], messages: { 1: [message(1, 'them', 'hey')] } })
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
    state.conversations = [conversation(1, dana, { unreadCount: 1, lastMessage: { id: pushed.id, senderId: dana.id, content: pushed.content, createdAt: pushed.createdAt } })]

    await live.push(PUSH, pushed)

    expect(await screen.findByText('just now!')).toBeInTheDocument()
    await waitFor(() => expect(state.read).toContain(1))
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('0'))
  })

  it('a message pushed while looking at the inbox moves that conversation to the top and raises the count', async () => {
    const state = serve({
      conversations: [
        conversation(1, dana, { lastMessage: { id: 10, senderId: dana.id, content: 'older chat', createdAt: minutesAgo(60) } }),
        conversation(2, eli, { lastMessage: { id: 20, senderId: eli.id, content: 'newer chat', createdAt: minutesAgo(10) } }),
      ],
    })
    const { live } = open('/messages', state)
    await screen.findByRole('link', { name: 'Conversation with Eli Eng' })
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('0'))
    const pushed = message(1, 'them', 'psst, new message', { id: 30, createdAt: new Date().toISOString() })
    state.conversations = state.conversations.map((c) => (c.id === 1 ? { ...c, unreadCount: 1, lastMessage: { id: 30, senderId: dana.id, content: pushed.content, createdAt: pushed.createdAt } } : c))

    await live.push(PUSH, pushed)

    await waitFor(() => expect(screen.getAllByRole('link', { name: /Conversation with/ })[0]).toHaveAccessibleName('Conversation with Dana Dev, 1 unread'))
    expect(screen.getAllByRole('link', { name: /Conversation with/ })[0]).toHaveTextContent('psst, new message')
    expect(screen.getByTestId('badge')).toHaveTextContent('1')
  })

  it('after the connection comes up it reads the real state, so messages from before are not missed', async () => {
    const state = serve({ conversations: [] })
    const { live } = open('/messages', state)
    await screen.findByText('No messages yet')
    state.conversations = [conversation(1, dana, { unreadCount: 2, lastMessage: { id: 5, senderId: dana.id, content: 'sent while connecting', createdAt: minutesAgo(1) } })]

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
      return HttpResponse.json({ items: (first ? stale : state.messages[1]).slice().reverse(), nextCursor: null })
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
      return HttpResponse.json({ items: (slow ? stale : state.messages[1]).slice().reverse(), nextCursor: null }) // newest first
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
