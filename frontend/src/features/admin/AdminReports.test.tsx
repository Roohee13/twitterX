import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes, useLocation } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { AccountStatus, AdminPostReport, AdminUserReport, ReportStatus } from '../../lib/types'
import { makeUser } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { AdminReportsPage } from './AdminReportsPage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const admin = makeUser({ id: 1, username: 'alice', displayName: 'Alice' })
const reporter = makeUser({ id: 20, username: 'rita', displayName: 'Rita Reporter' })
const bad = makeUser({ id: 30, username: 'bad_actor', displayName: 'Bad Actor' })

let nextId = 100
const userReport = (overrides: Partial<AdminUserReport> = {}): AdminUserReport => ({
  id: nextId++, reporter, reportedUser: bad, reason: 'SPAM', status: 'OPEN', createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  handledBy: null, handledAt: null, adminNote: null, totalReports: 1, reportedUserStatus: 'ACTIVE', ...overrides,
})
const postReport = (overrides: Partial<AdminPostReport> = {}): AdminPostReport => ({
  id: nextId++, reporter, reason: 'HARASSMENT', status: 'OPEN', createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), handledBy: null, handledAt: null, adminNote: null, totalReports: 1,
  post: { id: 500, author: bad, content: 'a rude post', mediaUrls: [], createdAt: new Date(Date.now() - 3_600_000).toISOString(), removed: false }, ...overrides,
})

/** A fake server holding the reports; changes move reports between the Open and Handled lists like the real one. */
function serve(initial: { users?: AdminUserReport[]; posts?: AdminPostReport[] } = {}) {
  const state = { users: initial.users ?? [], posts: initial.posts ?? [], requested: [] as string[], patches: [] as Array<{ kind: string; id: number; status: string }>, removed: [] as number[], removeNotes: [] as string[], accountCalls: [] as Array<{ action: string; id: number; note: string | null }> }
  const matches = (status: ReportStatus, filter: string | null) => filter === 'ALL' || (filter === 'HANDLED' ? status !== 'OPEN' : status === 'OPEN')
  server.use(
    http.get(`${BASE}/api/admin/reports/:kind`, ({ params, request }) => {
      const filter = new URL(request.url).searchParams.get('status')
      state.requested.push(`${params.kind}:${filter}`)
      const rows = (params.kind === 'users' ? state.users : state.posts) as Array<{ status: ReportStatus }>
      return HttpResponse.json({ items: rows.filter((r) => matches(r.status, filter)), nextCursor: null })
    }),
    http.patch(`${BASE}/api/admin/reports/:kind/:id`, async ({ params, request }) => {
      const { status } = (await request.json()) as { status: ReportStatus }
      state.patches.push({ kind: String(params.kind), id: Number(params.id), status })
      const rows = (params.kind === 'users' ? state.users : state.posts) as Array<{ id: number; status: ReportStatus; handledBy: unknown; handledAt: string | null }>
      const row = rows.find((r) => r.id === Number(params.id))
      if (!row) return HttpResponse.json({ status: 404, detail: 'Report not found' }, { status: 404 })
      Object.assign(row, { status, handledBy: status === 'OPEN' ? null : admin, handledAt: status === 'OPEN' ? null : new Date().toISOString() })
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${BASE}/api/admin/users/:id/:action`, async ({ params, request }) => {
      const body = (await request.json().catch(() => null)) as { note?: string } | null
      const action = String(params.action)
      state.accountCalls.push({ action, id: Number(params.id), note: body?.note ?? null })
      const next: Record<string, AccountStatus> = { suspend: 'SUSPENDED', unsuspend: 'ACTIVE', remove: 'DELETED' }
      for (const r of state.users) if (r.reportedUser.id === Number(params.id)) Object.assign(r, { reportedUserStatus: next[action], status: action === 'unsuspend' ? r.status : 'RESOLVED' })
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${BASE}/api/admin/posts/:id/remove`, async ({ params, request }) => {
      state.removeNotes.push(((await request.json().catch(() => ({}))) as { note?: string }).note ?? '')
      state.removed.push(Number(params.id))
      for (const r of state.posts) if (r.post.id === Number(params.id)) Object.assign(r, { status: r.status === 'OPEN' ? 'RESOLVED' : r.status, handledBy: admin, post: { ...r.post, removed: true } })
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return state
}

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function open(search = '', user: { admin: boolean } = { admin: true }) {
  return renderSignedIn(<><Routes><Route path="/admin/reports" element={<AdminReportsPage />} /></Routes><Where /></>, { route: `/admin/reports${search}`, user })
}

describe('access', () => {
  it('shows non-admins a clear screen and asks the server for nothing', async () => {
    const state = serve()
    open('', { admin: false })
    expect(await screen.findByText('This page is for admins')).toBeInTheDocument()
    expect(state.requested).toEqual([])
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })
})

describe('account reports', () => {
  it('lists who was reported, why, by whom, how long ago, and how many reports they have', async () => {
    serve({ users: [userReport({ reason: 'HATE_SPEECH', totalReports: 3 }), userReport({ reportedUser: makeUser({ id: 31, username: 'quiet_one', displayName: 'Quiet One', protectedAccount: true }), totalReports: 1 })] })
    open()

    const first = await screen.findByRole('article', { name: 'Report on @bad_actor' })
    expect(within(first).getByText('Hate speech')).toBeInTheDocument()
    expect(within(first).getByText('Open')).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: '@rita' })).toHaveAttribute('href', '/u/rita')
    expect(within(first).getByText('5m')).toBeInTheDocument()
    expect(within(first).getByRole('link', { name: /Bad Actor/ })).toHaveAttribute('href', '/u/bad_actor')
    expect(within(first).getByText('3 reports against this account')).toBeInTheDocument()
    const second = screen.getByRole('article', { name: 'Report on @quiet_one' })
    expect(within(second).getByText('1 report against this account')).toBeInTheDocument()
    expect(within(second).getByLabelText('Protected account')).toBeInTheDocument()
  })

  it('dismisses a report, which moves it out of the Open list', async () => {
    const state = serve({ users: [userReport({ id: 7 })] })
    open()

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(state.patches).toEqual([{ kind: 'users', id: 7, status: 'DISMISSED' }])
    expect(await screen.findByText('No open account reports')).toBeInTheDocument()
  })

  it('resolves, then shows who handled it under Handled, where it can be reopened', async () => {
    const state = serve({ users: [userReport({ id: 8 })] })
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(state.patches).toEqual([{ kind: 'users', id: 8, status: 'RESOLVED' }]))

    await userEvent.click(screen.getByRole('tab', { name: 'Handled' }))
    const row = await screen.findByRole('article', { name: 'Report on @bad_actor' })
    expect(within(row).getByText('Resolved')).toBeInTheDocument()
    expect(within(row).getByText(/Resolved by @alice/)).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()

    await userEvent.click(within(row).getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(state.patches.at(-1)).toEqual({ kind: 'users', id: 8, status: 'OPEN' }))
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument()) // back in the Open list
  })

  it('shows the server message when a report cannot be updated', async () => {
    serve({ users: [userReport({ id: 9 })] })
    server.use(http.patch(`${BASE}/api/admin/reports/users/9`, () => HttpResponse.json({ status: 404, detail: 'Report not found' }, { status: 404 })))
    open()

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))

    expect(await screen.findByText('Report not found')).toBeInTheDocument()
    expect(screen.getByRole('article')).toBeInTheDocument() // still there to try again
  })
})

describe('suspending and removing accounts', () => {
  it('suspends with a reason after asking, and the account then shows as suspended', async () => {
    const state = serve({ users: [userReport({ id: 60 })] })
    open('?status=ALL')

    await userEvent.click(await screen.findByRole('button', { name: 'Suspend account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Suspend @bad_actor?' })
    expect(state.accountCalls).toEqual([]) // nothing until confirmed
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Repeated spam')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend account' }))

    await waitFor(() => expect(state.accountCalls).toEqual([{ action: 'suspend', id: 30, note: 'Repeated spam' }]))
    expect(await screen.findByText('The account was suspended.')).toBeInTheDocument()
    expect(await screen.findByText('Suspended')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unsuspend account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend account' })).not.toBeInTheDocument()
  })

  it('cancelling the suspension does nothing', async () => {
    const state = serve({ users: [userReport()] })
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend account' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Suspend @bad_actor?' })).getByRole('button', { name: 'Cancel' }))
    expect(state.accountCalls).toEqual([])
  })

  it('lifts a suspension without asking for a reason', async () => {
    const state = serve({ users: [userReport({ id: 61, reportedUserStatus: 'SUSPENDED', status: 'RESOLVED', handledBy: admin, handledAt: new Date().toISOString() })] })
    open('?status=HANDLED')

    await userEvent.click(await screen.findByRole('button', { name: 'Unsuspend account' }))

    await waitFor(() => expect(state.accountCalls).toEqual([{ action: 'unsuspend', id: 30, note: null }]))
    expect(await screen.findByText('The suspension was lifted.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Suspend account' })).toBeInTheDocument()
  })

  it('will not remove an account until its username is typed, then removes it for good', async () => {
    const state = serve({ users: [userReport()] })
    open('?status=ALL')
    await userEvent.click(await screen.findByRole('button', { name: 'Remove account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove @bad_actor?' })
    const confirm = within(dialog).getByRole('button', { name: 'Remove account' })

    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Type bad_actor to confirm'), 'bad_acto')
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Type bad_actor to confirm'), 'r')
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)

    await waitFor(() => expect(state.accountCalls).toEqual([{ action: 'remove', id: 30, note: '' }]))
    expect(await screen.findByText('The account was removed.')).toBeInTheDocument()
    expect(await screen.findByText('Removed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove account' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend account' })).not.toBeInTheDocument()
  })

  it('keeps the dialog open and shows the message when the server refuses (an admin target)', async () => {
    serve({ users: [userReport()] })
    server.use(http.post(`${BASE}/api/admin/users/30/suspend`, () => HttpResponse.json({ status: 403, detail: 'Admins cannot be suspended or removed' }, { status: 403 })))
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend account' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Suspend @bad_actor?' })).getByRole('button', { name: 'Suspend account' }))

    expect(await screen.findByText('Admins cannot be suspended or removed')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Suspend @bad_actor?' })).toBeInTheDocument()
  })
})

describe('post reports', () => {
  const openPosts = () => open('?tab=posts')

  it('shows the reported post with its author, text and total reports', async () => {
    serve({ posts: [postReport({ totalReports: 2 })] })
    openPosts()

    const row = await screen.findByRole('article', { name: 'Report on a post by @bad_actor' })
    expect(within(row).getByText('a rude post')).toBeInTheDocument()
    expect(within(row).getByText('Harassment')).toBeInTheDocument()
    expect(within(row).getByText('2 reports against this post')).toBeInTheDocument()
  })

  it('asks before removing a post, then removes it and resolves its reports', async () => {
    const state = serve({ posts: [postReport({ id: 41 })] })
    openPosts()

    await userEvent.click(await screen.findByRole('button', { name: 'Remove post' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove this post?' })
    expect(state.removed).toEqual([]) // nothing yet
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(state.removed).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Remove post' }))
    const second = await screen.findByRole('dialog', { name: 'Remove this post?' })
    await userEvent.type(within(second).getByLabelText(/Reason/), 'Targeted harassment')
    await userEvent.click(within(second).getByRole('button', { name: 'Remove post' }))

    await waitFor(() => expect(state.removed).toEqual([500]))
    expect(state.removeNotes).toEqual(['Targeted harassment'])
    expect(await screen.findByText('The post was removed and its open reports resolved.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument()) // resolved, so off the Open list
  })

  it('marks a removed post and does not offer to remove it again', async () => {
    serve({ posts: [postReport({ status: 'RESOLVED', handledBy: admin, handledAt: new Date().toISOString(), post: { id: 500, author: bad, content: 'gone now', mediaUrls: [], createdAt: new Date().toISOString(), removed: true } })] })
    open('?tab=posts&status=HANDLED')

    const row = await screen.findByRole('article', { name: /Report on a post/ })
    expect(within(row).getByText('This post has been removed.')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Remove post' })).not.toBeInTheDocument()
    expect(within(row).getByText('gone now')).toBeInTheDocument() // admins still see what was reported
  })

  it('has its own empty message', async () => {
    serve()
    openPosts()
    expect(await screen.findByText('No open post reports')).toBeInTheDocument()
  })
})

describe('tabs and filters', () => {
  it('asks for the right list and keeps the choice in the address', async () => {
    const state = serve({ users: [userReport()] })
    open()
    await screen.findByRole('article')
    expect(state.requested).toEqual(['users:OPEN'])

    await userEvent.click(screen.getByRole('tab', { name: 'Posts' }))
    await waitFor(() => expect(state.requested).toContain('posts:OPEN'))
    expect(screen.getByTestId('where')).toHaveTextContent('tab=posts')

    await userEvent.click(screen.getByRole('tab', { name: 'All' }))
    await waitFor(() => expect(state.requested).toContain('posts:ALL'))
    expect(screen.getByTestId('where')).toHaveTextContent('status=ALL')
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
  })

  it('opens straight on the list in the address', async () => {
    const state = serve()
    open('?tab=posts&status=HANDLED')
    await waitFor(() => expect(state.requested).toEqual(['posts:HANDLED']))
    expect(screen.getByRole('tab', { name: 'Posts' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Handled' })).toHaveAttribute('aria-selected', 'true')
  })

  it('offers a retry when the list cannot be loaded', async () => {
    serve()
    let fail = true
    server.use(http.get(`${BASE}/api/admin/reports/users`, () => (fail ? HttpResponse.json({ status: 403, detail: 'Admins only' }, { status: 403 }) : HttpResponse.json({ items: [userReport()], nextCursor: null }))))
    open()

    expect(await screen.findByRole('alert')).toHaveTextContent('Admins only')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('article', { name: 'Report on @bad_actor' })).toBeInTheDocument()
  })
})
