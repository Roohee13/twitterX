import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { ConversationResponse, GroupMember, MessageResponse } from '../../lib/types'
import { fakeSocket } from '../../test/fakeSocket'
import { makeUser } from '../../test/fixtures'
import { BASE, me, renderSignedIn, server } from '../../test/render'
import { LiveSocketContext } from '../notifications/liveSocketContext'
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
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const group = (overrides: Partial<ConversationResponse> = {}): ConversationResponse => ({
  id: 7, type: 'GROUP', title: 'Weekend plans', memberCount: 3, participant: null,
  createdAt: minutesAgo(60), updatedAt: minutesAgo(5), lastMessage: null, unreadCount: 0, ...overrides,
})
const said = (id: number, from: typeof dana | typeof meSummary, content: string): MessageResponse => ({
  id, conversationId: 7, sender: from, content, createdAt: minutesAgo(5), editedAt: null, deleted: false,
})
const member = (user: typeof dana, role: GroupMember['role'] = 'MEMBER'): GroupMember => ({ user, role, joinedAt: minutesAgo(50) })

/** A fake server for one group (id 7). `members` and `title` change the way the real server's would. */
function serve(options: { owner?: boolean; messages?: MessageResponse[]; lastMessage?: ConversationResponse['lastMessage']; unread?: number } = {}) {
  const owner = options.owner ?? true
  const state = {
    title: 'Weekend plans',
    members: [member(meSummary, owner ? 'OWNER' : 'MEMBER'), member(dana, owner ? 'MEMBER' : 'OWNER'), member(eli)],
    created: null as null | { title: string; usernames: string[] },
    added: [] as string[],
    removed: [] as number[],
    left: 0,
    renamed: [] as string[],
    cleared: 0,
  }
  const current = () => group({ title: state.title, memberCount: state.members.length, lastMessage: options.lastMessage ?? null, unreadCount: options.unread ?? 0 })
  server.use(
    http.get(`${BASE}/api/conversations/unread-count`, () => HttpResponse.json({ count: options.unread ?? 0 })),
    http.get(`${BASE}/api/conversations`, () => HttpResponse.json({ items: options.lastMessage ? [current()] : [], nextCursor: null })),
    http.post(`${BASE}/api/conversations/groups`, async ({ request }) => {
      state.created = (await request.json()) as { title: string; usernames: string[] }
      if (state.created.usernames.includes('blocked_one')) return HttpResponse.json({ status: 403, detail: 'This action is not allowed because of a block' }, { status: 403 })
      return HttpResponse.json(group({ id: 700, title: state.created.title }), { status: 201 })
    }),
    http.get(`${BASE}/api/conversations/700`, () => HttpResponse.json(group({ id: 700, title: state.created?.title ?? 'New' }))),
    http.get(`${BASE}/api/conversations/700/messages`, () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get(`${BASE}/api/conversations/7`, () => HttpResponse.json(current())),
    http.get(`${BASE}/api/conversations/7/messages`, () => HttpResponse.json({ items: options.messages ?? [], nextCursor: null })),
    http.post(`${BASE}/api/conversations/7/read`, () => new HttpResponse(null, { status: 204 })),
    http.delete(`${BASE}/api/conversations/7`, () => {
      state.cleared += 1
      return new HttpResponse(null, { status: 204 })
    }),
    http.patch(`${BASE}/api/conversations/7`, async ({ request }) => {
      const { title } = (await request.json()) as { title: string }
      state.title = title
      state.renamed.push(title)
      return HttpResponse.json(current())
    }),
    http.get(`${BASE}/api/conversations/7/members`, () => HttpResponse.json(state.members)),
    http.post(`${BASE}/api/conversations/7/members`, async ({ request }) => {
      const { usernames } = (await request.json()) as { usernames: string[] }
      state.added.push(...usernames)
      state.members = [...state.members, member(makeUser({ id: 60, username: usernames[0], displayName: 'Nina Newbie' }))]
      return HttpResponse.json(state.members)
    }),
    http.delete(`${BASE}/api/conversations/7/members/:userId`, ({ params }) => {
      state.removed.push(Number(params.userId))
      state.members = state.members.filter((m) => m.user.id !== Number(params.userId))
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${BASE}/api/conversations/7/leave`, () => {
      state.left += 1
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`${BASE}/api/users/search`, () => HttpResponse.json([makeUser({ id: 60, username: 'newbie', displayName: 'Nina Newbie' }), makeUser({ id: 61, username: 'blocked_one', displayName: 'Blocked One' })])),
  )
  return state
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}
function Shell({ children }: { children: React.ReactNode }) {
  useLiveMessages()
  const unread = useUnreadMessages()
  return <><p data-testid="badge">{unread.data ?? '-'}</p>{children}</>
}
function open(route: string) {
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
  return live
}
const UPDATES = '/user/queue/conversation-updates'
const lastFromDana = { id: 70, senderId: dana.id, content: 'see you saturday', createdAt: minutesAgo(3), deleted: false, senderName: 'Dana Dev' }

describe('a group in the inbox', () => {
  it('shows its name, size, who said the last thing and the unread count', async () => {
    serve({ lastMessage: lastFromDana, unread: 2 })
    open('/messages')

    const row = await screen.findByRole('link', { name: 'Group Weekend plans, 2 unread' })
    expect(row).toHaveAttribute('href', '/messages/7')
    expect(row).toHaveTextContent('3 members')
    expect(row).toHaveTextContent('Dana Dev: see you saturday')
  })

  it('"New group" creates a group from a name and the people picked, and opens it', async () => {
    const state = serve()
    open('/messages')

    await userEvent.click(await screen.findByRole('button', { name: /New group/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New group' })
    const create = within(dialog).getByRole('button', { name: 'Create group' })
    expect(create).toBeDisabled() // needs a name and at least one person
    await userEvent.type(within(dialog).getByLabelText('Group name'), 'Book club')
    await userEvent.type(within(dialog).getByLabelText('Add people'), 'nin')
    await userEvent.click(await within(dialog).findByRole('button', { name: /Nina Newbie/ }))
    expect(within(dialog).getByRole('list', { name: 'Selected people' })).toHaveTextContent('Nina Newbie')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create group' }))

    await waitFor(() => expect(state.created).toEqual({ title: 'Book club', usernames: ['newbie'] }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/messages/700'))
    expect(await screen.findByRole('heading', { name: 'Book club' })).toBeInTheDocument()
  })

  it('a person picked by mistake can be taken out again, and a refused group shows why', async () => {
    const state = serve()
    open('/messages')

    await userEvent.click(await screen.findByRole('button', { name: /New group/ }))
    const dialog = await screen.findByRole('dialog', { name: 'New group' })
    await userEvent.type(within(dialog).getByLabelText('Group name'), 'Nope')
    await userEvent.type(within(dialog).getByLabelText('Add people'), 'blo')
    await userEvent.click(await within(dialog).findByRole('button', { name: /Blocked One/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Blocked One' }))
    expect(within(dialog).getByRole('button', { name: 'Create group' })).toBeDisabled()

    await userEvent.click(await within(dialog).findByRole('button', { name: /Blocked One/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create group' }))

    expect(await screen.findByText('This action is not allowed because of a block')).toBeInTheDocument()
    expect(state.created?.usernames).toEqual(['blocked_one'])
    expect(screen.getByTestId('where')).not.toHaveTextContent('/messages/')
  })
})

describe('a group chat', () => {
  it('shows the group name, and the name of whoever else wrote above their message', async () => {
    serve({ messages: [said(70, dana, 'who is bringing snacks'), said(71, meSummary, 'i am')] })
    open('/messages/7')

    expect(await screen.findByRole('heading', { name: 'Weekend plans' })).toBeInTheDocument()
    const theirs = await screen.findByText('who is bringing snacks')
    expect(theirs.closest('div[class*="items-start"]')?.previousElementSibling).toHaveTextContent('Dana Dev')
    expect(screen.getAllByText('Dana Dev')).toHaveLength(1) // not repeated above my own message
    expect(screen.getByText('i am')).toBeInTheDocument()
  })

  it('invites you to say hello to the group when nothing has been said', async () => {
    serve()
    open('/messages/7')
    expect(await screen.findByText('No messages yet. Say hello to the group.')).toBeInTheDocument()
  })

  it('explains that deleting the conversation keeps you in the group', async () => {
    const state = serve({ messages: [said(70, dana, 'hi')] })
    open('/messages/7')

    await userEvent.click(await screen.findByRole('button', { name: 'Conversation actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete conversation' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this conversation?' })
    expect(dialog).toHaveTextContent('you stay in the group')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(state.cleared).toBe(1))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/messages'))
  })
})

describe('group info', () => {
  const openInfo = async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Conversation actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Group info' }))
    return screen.findByRole('dialog', { name: 'Group info' })
  }

  it('lists the members, marks the owner, and lets the owner rename the group', async () => {
    const state = serve()
    open('/messages/7')
    const dialog = await openInfo()

    const items = await within(dialog).findAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([expect.stringContaining('Alice (you)'), expect.stringContaining('Dana Dev'), expect.stringContaining('Eli Eng')])
    expect(items[0]).toHaveTextContent('Owner')

    const name = within(dialog).getByLabelText('Group name')
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled() // nothing changed yet
    await userEvent.clear(name)
    await userEvent.type(name, 'Saturday plans')
    await userEvent.click(save)

    await waitFor(() => expect(state.renamed).toEqual(['Saturday plans']))
    expect(await screen.findByRole('heading', { name: 'Saturday plans' })).toBeInTheDocument()
  })

  it('lets the owner remove someone after asking', async () => {
    const state = serve()
    open('/messages/7')
    const dialog = await openInfo()

    await userEvent.click(await within(dialog).findByRole('button', { name: 'Remove Eli Eng' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remove Eli Eng?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(state.removed).toEqual([eli.id]))
    await waitFor(() => expect(within(dialog).queryByText('Eli Eng')).not.toBeInTheDocument())
  })

  it('does not offer anyone but the owner a way to rename or remove', async () => {
    serve({ owner: false })
    open('/messages/7')
    const dialog = await openInfo()

    await within(dialog).findByText('Dana Dev')
    expect(within(dialog).queryByLabelText('Group name')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add people' })).toBeEnabled() // any member can add
  })

  it('adds someone found by name', async () => {
    const state = serve()
    open('/messages/7')
    const dialog = await openInfo()

    await userEvent.click(await within(dialog).findByRole('button', { name: 'Add people' }))
    await userEvent.type(within(dialog).getByLabelText('Add people'), 'nin')
    await userEvent.click(await within(dialog).findByRole('button', { name: /Nina Newbie/ }))

    await waitFor(() => expect(state.added).toEqual(['newbie']))
    expect(await within(dialog).findByText('Nina Newbie')).toBeInTheDocument()
  })

  it('leaves the group after asking and goes back to the inbox', async () => {
    const state = serve()
    open('/messages/7')
    const dialog = await openInfo()

    await userEvent.click(await within(dialog).findByRole('button', { name: 'Leave group' }))
    const confirm = await screen.findByRole('dialog', { name: 'Leave this group?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Leave' }))

    await waitFor(() => expect(state.left).toBe(1))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/messages'))
    expect(screen.getByTestId('where')).not.toHaveTextContent('/messages/')
  })
})

describe('a group changing live', () => {
  it('a rename pushed by the server shows in the open chat', async () => {
    const state = serve()
    const live = open('/messages/7')
    await screen.findByRole('heading', { name: 'Weekend plans' })
    expect(live.subscribed(UPDATES)).toBeGreaterThan(0)

    state.title = 'Sunday plans' // the server already has it when it pushes; the lists are read again after the push
    await live.push(UPDATES, { conversationId: 7, removed: false, conversation: group({ title: 'Sunday plans', memberCount: 4 }) })

    expect(await screen.findByRole('heading', { name: 'Sunday plans' })).toBeInTheDocument()
  })

  it('being removed from the group you have open takes you back to the inbox', async () => {
    serve()
    const live = open('/messages/7')
    await screen.findByRole('heading', { name: 'Weekend plans' })

    await live.push(UPDATES, { conversationId: 7, removed: true, conversation: null })

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/messages'))
    expect(screen.getByTestId('where')).not.toHaveTextContent('/messages/')
  })
})
