import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { act } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import type { LiveSocket } from '../../lib/socket'
import { tokens } from '../../lib/tokens'
import type { NotificationResponse, NotificationType } from '../../lib/types'
import { makeUser } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { LiveSocketContext } from './liveSocketContext'
import { useLiveNotifications, useUnreadCount } from './notificationHooks'
import { NotificationsPage } from './NotificationsPage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const carol = makeUser({ id: 21, username: 'carol', displayName: 'Carol Chen' })
let nextId = 1
const note = (type: NotificationType, overrides: Partial<NotificationResponse> = {}): NotificationResponse => ({
  id: nextId++, type, actor: carol, postId: null, postContent: null, detail: null, read: false, createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), ...overrides,
})

/** A fake server holding the notifications, answering reads, deletes and the unread count like the real one. */
function serve(initial: NotificationResponse[]) {
  const state = { items: [...initial], read: [] as number[], readAll: 0, deleted: [] as number[] }
  server.use(
    http.get(`${BASE}/api/notifications/unread-count`, () => HttpResponse.json({ count: state.items.filter((n) => !n.read).length })),
    http.get(`${BASE}/api/notifications`, () => HttpResponse.json({ items: state.items, nextCursor: null })),
    http.post(`${BASE}/api/notifications/read`, () => {
      state.readAll += 1
      state.items = state.items.map((n) => ({ ...n, read: true }))
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${BASE}/api/notifications/:id/read`, ({ params }) => {
      state.read.push(Number(params.id))
      state.items = state.items.map((n) => (n.id === Number(params.id) ? { ...n, read: true } : n))
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete(`${BASE}/api/notifications/:id`, ({ params }) => {
      state.deleted.push(Number(params.id))
      state.items = state.items.filter((n) => n.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return state
}

/** Stands in for the live connection: the test calls `push` the way the server would. */
function fakeSocket() {
  const handlers = new Map<string, Array<(body: unknown) => void>>()
  const connectListeners: Array<() => void> = []
  const socket = {
    onConnect(listener: () => void) {
      connectListeners.push(listener)
      return () => undefined
    },
    subscribe(destination: string, handler: (body: unknown) => void) {
      handlers.set(destination, [...(handlers.get(destination) ?? []), handler])
      return () => handlers.set(destination, (handlers.get(destination) ?? []).filter((h) => h !== handler))
    },
  } as unknown as LiveSocket
  return { socket, connect: () => act(() => connectListeners.forEach((l) => l())), push: (body: unknown) => act(() => handlers.get('/user/queue/notifications')?.forEach((h) => h(body))), subscribed: () => handlers.get('/user/queue/notifications')?.length ?? 0 }
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}
function Shell({ children }: { children: React.ReactNode }) {
  useLiveNotifications()
  const unread = useUnreadCount()
  return <><p data-testid="badge">{unread.data ?? '-'}</p>{children}</>
}

function open(items: NotificationResponse[]) {
  const state = serve(items)
  const live = fakeSocket()
  renderSignedIn(
    <LiveSocketContext.Provider value={live.socket}>
      <Shell>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="*" element={<p>somewhere else</p>} />
        </Routes>
        <Where />
      </Shell>
    </LiveSocketContext.Provider>,
    { route: '/notifications' },
  )
  return { state, live }
}

describe('what each notification says', () => {
  it('names the actor and the action for people-and-post notifications, with a link to the right place', async () => {
    open([
      note('FOLLOW'),
      note('LIKE', { postId: 7, postContent: 'my liked post' }),
      note('REPOST', { postId: 8, postContent: 'my reposted post' }),
      note('REPLY', { postId: 9, postContent: 'their reply text' }),
      note('MENTION', { postId: 10 }),
      note('FOLLOW_REQUEST'),
    ])
    expect(await screen.findByRole('article', { name: 'Unread: Carol Chen followed you' })).toBeInTheDocument()
    const like = screen.getByRole('article', { name: 'Unread: Carol Chen liked your post' })
    expect(within(like).getByText('my liked post')).toBeInTheDocument()
    expect(within(like).getByRole('link')).toHaveAttribute('href', '/post/7')
    expect(within(screen.getByRole('article', { name: /followed you/ })).getByRole('link')).toHaveAttribute('href', '/u/carol')
    expect(within(screen.getByRole('article', { name: /reposted your post/ })).getByRole('link')).toHaveAttribute('href', '/post/8')
    expect(within(screen.getByRole('article', { name: /replied to your post/ })).getByRole('link')).toHaveAttribute('href', '/post/9')
    expect(within(screen.getByRole('article', { name: /mentioned you/ })).getByRole('link')).toHaveAttribute('href', '/post/10')
    expect(within(screen.getByRole('article', { name: /asked to follow you/ })).getByRole('link')).toHaveAttribute('href', '/follow-requests')
  })

  it('shows moderation messages without a name, using the text the server sent', async () => {
    open([
      note('REPORT_RECEIVED', { actor: null, detail: 'New report: account @spammer (spam)' }),
      note('POST_REMOVED', { actor: null, detail: 'An admin removed your post for breaking the rules. Reason: Targeted harassment' }),
      note('REPORT_OUTCOME', { actor: null, detail: 'Thanks for your report about @spammer: we took action.' }),
    ])
    const alert = await screen.findByRole('article', { name: 'Unread: New report: account @spammer (spam)' })
    expect(within(alert).getByRole('link')).toHaveAttribute('href', '/admin/reports')
    const removed = screen.getByRole('article', { name: /An admin removed your post/ })
    expect(removed).toHaveTextContent('Reason: Targeted harassment')
    expect(within(removed).queryByRole('link')).not.toBeInTheDocument() // nowhere to go
    expect(screen.getByRole('article', { name: /we took action/ })).toBeInTheDocument()
  })

  it('says when there is nothing yet', async () => {
    open([])
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument()
  })
})

describe('reading and deleting', () => {
  it('marks one notification read when it is opened, and the badge goes down by one', async () => {
    const { state } = open([note('LIKE', { id: 501, postId: 7 }), note('FOLLOW', { id: 502 })])
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('2'))

    await userEvent.click(within(await screen.findByRole('article', { name: /liked your post/ })).getByRole('link'))

    await waitFor(() => expect(state.read).toEqual([501]))
    expect(screen.getByTestId('badge')).toHaveTextContent('1')
    expect(screen.getByTestId('where')).toHaveTextContent('/post/7')
  })

  it('opening one that is already read does not call the server again', async () => {
    const { state } = open([note('FOLLOW', { read: true })])
    await userEvent.click(within(await screen.findByRole('article', { name: 'Carol Chen followed you' })).getByRole('link'))
    expect(state.read).toEqual([])
  })

  it('"Mark all read" clears everything and the badge, then is disabled', async () => {
    const { state } = open([note('LIKE'), note('FOLLOW')])
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('2'))

    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))

    await waitFor(() => expect(state.readAll).toBe(1))
    expect(screen.getByTestId('badge')).toHaveTextContent('0')
    expect(screen.queryByRole('article', { name: /^Unread/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
  })

  it('deletes a notification, and an unread one also lowers the badge', async () => {
    const { state } = open([note('FOLLOW', { id: 601 }), note('LIKE', { id: 602, read: true, postId: 3 })])
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('1'))

    await userEvent.click(within(await screen.findByRole('article', { name: /followed you/ })).getByRole('button', { name: 'Delete notification' }))

    await waitFor(() => expect(state.deleted).toEqual([601]))
    expect(screen.queryByRole('article', { name: /followed you/ })).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: /liked your post/ })).toBeInTheDocument()
    expect(screen.getByTestId('badge')).toHaveTextContent('0')
  })

  it('an older answer that arrives after a delete does not bring the notification back', async () => {
    const { state, live } = open([note('FOLLOW', { id: 801 })])
    await screen.findByRole('article', { name: /followed you/ })
    const stale = [...state.items]
    let slow = true
    server.use(http.get(`${BASE}/api/notifications`, async () => {
      if (!slow) return HttpResponse.json({ items: state.items, nextCursor: null })
      await new Promise((r) => setTimeout(r, 120)) // the catch-up read after the socket connected: prepared before the delete
      return HttpResponse.json({ items: stale, nextCursor: null })
    }))
    await live.connect()

    await userEvent.click(within(screen.getByRole('article', { name: /followed you/ })).getByRole('button', { name: 'Delete notification' }))
    slow = false
    await new Promise((r) => setTimeout(r, 250))

    expect(screen.queryByRole('article', { name: /followed you/ })).not.toBeInTheDocument()
  })

  it('shows the server message when something cannot be deleted, and restores the list', async () => {
    open([note('FOLLOW', { id: 701 })])
    server.use(http.delete(`${BASE}/api/notifications/701`, () => HttpResponse.json({ status: 500, detail: 'Database is down' }, { status: 500 })))

    await userEvent.click(within(await screen.findByRole('article', { name: /followed you/ })).getByRole('button', { name: 'Delete notification' }))

    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })
})

describe('live notifications', () => {
  it('after the connection comes up it reads the real state, so what arrived before it is not missed', async () => {
    const { state, live } = open([])
    await screen.findByText('Nothing here yet')
    expect(screen.getByTestId('badge')).toHaveTextContent('0')
    state.items = [note('LIKE', { id: 990, postId: 1 })] // happened while the socket was still connecting: never pushed

    await live.connect()

    expect(await screen.findByRole('article', { name: /liked your post/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('1'))
  })

  it('puts a pushed notification at the top of the list and raises the badge, without a reload', async () => {
    const { state, live } = open([note('FOLLOW', { id: 801, read: true })])
    await screen.findByRole('article', { name: /followed you/ })
    expect(screen.getByTestId('badge')).toHaveTextContent('0')
    const pushed = note('LIKE', { id: 802, postId: 4, postContent: 'fresh like' })
    state.items.unshift(pushed) // the server has saved it by the time it pushes it

    await live.push(pushed)

    // The query cache tells the screen about changes on its next tick, so wait for it.
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2))
    expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Unread: Carol Chen liked your post')
    expect(screen.getByTestId('badge')).toHaveTextContent('1')
  })

  it('does not show the same notification twice if it is pushed again', async () => {
    const { state, live } = open([])
    await screen.findByText('Nothing here yet')
    const pushed = note('FOLLOW', { id: 900 })
    state.items.push(pushed)

    await live.push(pushed)
    await screen.findByRole('article', { name: /followed you/ })
    await live.push(pushed)

    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('a notification pushed while the list is still loading is not lost', async () => {
    const pushed = note('LIKE', { id: 950, postId: 2 })
    const state = serve([])
    let calls = 0
    server.use(http.get(`${BASE}/api/notifications`, async () => {
      calls += 1
      const first = calls === 1
      await new Promise((r) => setTimeout(r, 60))
      return HttpResponse.json({ items: first ? [] : [pushed], nextCursor: null }) // the first answer was prepared before the like happened
    }))
    const live = fakeSocket()
    renderSignedIn(
      <LiveSocketContext.Provider value={live.socket}>
        <Shell><Routes><Route path="/notifications" element={<NotificationsPage />} /></Routes></Shell>
      </LiveSocketContext.Provider>,
      { route: '/notifications' },
    )
    await waitFor(() => expect(live.subscribed()).toBe(1))

    await live.push(pushed)

    expect(await screen.findByRole('article', { name: /liked your post/ })).toBeInTheDocument()
    expect(state.items).toEqual([])
  })

  it('a count that was answered before the push but arrives after it does not wipe the badge out', async () => {
    const pushed = note('LIKE', { id: 960, postId: 2 })
    const state = serve([])
    let calls = 0
    server.use(http.get(`${BASE}/api/notifications/unread-count`, async () => {
      calls += 1
      const stale = calls === 1 // sent before the like happened, answered after it
      await new Promise((r) => setTimeout(r, stale ? 80 : 0))
      return HttpResponse.json({ count: stale ? 0 : state.items.filter((n) => !n.read).length })
    }))
    const live = fakeSocket()
    renderSignedIn(
      <LiveSocketContext.Provider value={live.socket}>
        <Shell><Routes><Route path="/notifications" element={<NotificationsPage />} /></Routes></Shell>
      </LiveSocketContext.Provider>,
      { route: '/notifications' },
    )
    await waitFor(() => expect(live.subscribed()).toBe(1))
    state.items.push(pushed)

    await live.push(pushed)
    await new Promise((r) => setTimeout(r, 150)) // long enough for the stale answer to have arrived

    expect(screen.getByTestId('badge')).toHaveTextContent('1')
  })

  it('also refreshes the follow-request list when someone asks to follow', async () => {
    const { live } = open([])
    let requested = 0
    server.use(http.get(`${BASE}/api/users/me/follow-requests`, () => {
      requested += 1
      return HttpResponse.json({ items: [], nextCursor: null })
    }))
    await screen.findByText('Nothing here yet')
    // Only lists that are on screen refetch; with none open this must simply not fail.
    await live.push(note('FOLLOW_REQUEST'))
    expect(requested).toBe(0)
  })
})
