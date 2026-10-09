import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { UserSummary } from '../../lib/types'
import { makeUser } from '../../test/fixtures'
import { BASE, me, renderSignedIn, server } from '../../test/render'
import { SettingsPage } from './SettingsPage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

interface Lists { blocks?: UserSummary[]; mutes?: UserSummary[] }

/** Fake server: records every change the page asks for, and answers the lists. */
function serve(lists: Lists = {}) {
  const state = {
    blocks: [...(lists.blocks ?? [])],
    mutes: [...(lists.mutes ?? [])],
    calls: [] as Array<{ method: string; path: string; body: unknown }>,
    loggedOut: 0,
  }
  const record = async (request: Request) => {
    const body = await request.clone().json().catch(() => undefined)
    state.calls.push({ method: request.method, path: new URL(request.url).pathname, body })
  }
  server.use(
    http.get(`${BASE}/api/users/me/blocks`, () => HttpResponse.json({ items: state.blocks, nextCursor: null })),
    http.get(`${BASE}/api/users/me/mutes`, () => HttpResponse.json({ items: state.mutes, nextCursor: null })),
    http.delete(`${BASE}/api/users/:username/block`, async ({ request, params }) => {
      await record(request)
      state.blocks = state.blocks.filter((u) => u.username !== params.username)
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete(`${BASE}/api/users/:username/mute`, async ({ request, params }) => {
      await record(request)
      state.mutes = state.mutes.filter((u) => u.username !== params.username)
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${BASE}/api/auth/logout`, () => {
      state.loggedOut += 1
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return { state, record }
}

const problem = (status: number, detail: string, errors?: Record<string, string>) => HttpResponse.json({ status, detail, errors }, { status })
const open = (lists?: Lists) => {
  const fake = serve(lists)
  renderSignedIn(<SettingsPage />, { route: '/settings' })
  return fake
}

describe('username', () => {
  it('shows the current one and changes it, telling you what it is now', async () => {
    const { state, record } = open()
    server.use(http.patch(`${BASE}/api/users/me/username`, async ({ request }) => {
      await record(request)
      return HttpResponse.json({ ...me, username: 'alice_new' })
    }))
    const form = await screen.findByRole('form', { name: 'Username' })
    expect(within(form).getByLabelText('Username')).toHaveValue('alice')

    await userEvent.clear(within(form).getByLabelText('Username'))
    await userEvent.type(within(form).getByLabelText('Username'), 'alice_new')
    await userEvent.click(within(form).getByRole('button', { name: 'Change username' }))

    expect(await within(form).findByText('Your username is now @alice_new.')).toBeInTheDocument()
    expect(state.calls).toEqual([{ method: 'PATCH', path: '/api/users/me/username', body: { username: 'alice_new' } }])
  })

  it('stops invalid and unchanged names before any request', async () => {
    const { state } = open()
    const form = await screen.findByRole('form', { name: 'Username' })
    const field = within(form).getByLabelText('Username')

    await userEvent.clear(field)
    await userEvent.type(field, 'no')
    await userEvent.click(within(form).getByRole('button', { name: 'Change username' }))
    expect(await within(form).findByText('Use 3-15 letters, digits or underscores')).toBeInTheDocument()

    await userEvent.clear(field)
    await userEvent.type(field, 'alice')
    await userEvent.click(within(form).getByRole('button', { name: 'Change username' }))
    expect(await within(form).findByText('That is already your username')).toBeInTheDocument()
    expect(state.calls).toEqual([])
  })

  it('shows "already taken" under the field and keeps the old name', async () => {
    open()
    server.use(http.patch(`${BASE}/api/users/me/username`, () => problem(409, 'Username is already taken')))
    const form = await screen.findByRole('form', { name: 'Username' })
    await userEvent.clear(within(form).getByLabelText('Username'))
    await userEvent.type(within(form).getByLabelText('Username'), 'taken_one')
    await userEvent.click(within(form).getByRole('button', { name: 'Change username' }))
    expect(await within(form).findByText('Username is already taken')).toBeInTheDocument()
    expect(within(form).queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('email', () => {
  it('changes it and says a link was sent', async () => {
    const { state, record } = open()
    server.use(http.patch(`${BASE}/api/users/me/email`, async ({ request }) => {
      await record(request)
      return HttpResponse.json({ ...me, email: 'new@example.com', emailVerified: false })
    }))
    const form = await screen.findByRole('form', { name: 'Email' })
    expect(within(form).getByLabelText('Email')).toHaveValue('alice@example.com')
    await userEvent.clear(within(form).getByLabelText('Email'))
    await userEvent.type(within(form).getByLabelText('Email'), 'new@example.com')
    await userEvent.click(within(form).getByRole('button', { name: 'Change email' }))

    expect(await within(form).findByText(/We sent a link to new@example.com/)).toBeInTheDocument()
    expect(state.calls[0].body).toEqual({ email: 'new@example.com' })
  })

  it('rejects a badly formed address locally and shows a conflict from the server', async () => {
    const { state } = open()
    server.use(http.patch(`${BASE}/api/users/me/email`, () => problem(409, 'Email is already registered')))
    const form = await screen.findByRole('form', { name: 'Email' })
    await userEvent.clear(within(form).getByLabelText('Email'))
    await userEvent.type(within(form).getByLabelText('Email'), 'not-an-email')
    await userEvent.click(within(form).getByRole('button', { name: 'Change email' }))
    expect(await within(form).findByText('Enter a valid email address')).toBeInTheDocument()
    expect(state.calls).toEqual([])

    await userEvent.clear(within(form).getByLabelText('Email'))
    await userEvent.type(within(form).getByLabelText('Email'), 'used@example.com')
    await userEvent.click(within(form).getByRole('button', { name: 'Change email' }))
    expect(await within(form).findByText('Email is already registered')).toBeInTheDocument()
  })
})

describe('password', () => {
  const fill = async (form: HTMLElement, current: string, next: string) => {
    if (current) await userEvent.type(within(form).getByLabelText('Current password'), current)
    if (next) await userEvent.type(within(form).getByLabelText('New password'), next)
    await userEvent.click(within(form).getByRole('button', { name: 'Change password' }))
  }

  it('changes it, then signs this session out like every other one', async () => {
    const { state, record } = open()
    server.use(http.patch(`${BASE}/api/users/me/password`, async ({ request }) => {
      await record(request)
      return new HttpResponse(null, { status: 204 })
    }))
    await fill(await screen.findByRole('form', { name: 'Password' }), 'oldpassword1', 'newpassword2')

    expect(await screen.findByText('Password changed. Please sign in again.')).toBeInTheDocument()
    expect(state.calls).toEqual([{ method: 'PATCH', path: '/api/users/me/password', body: { currentPassword: 'oldpassword1', newPassword: 'newpassword2' } }])
    await waitFor(() => expect(state.loggedOut).toBe(1))
    expect(tokens.getRefresh()).toBeNull()
  })

  it('checks both fields locally', async () => {
    const { state } = open()
    const form = await screen.findByRole('form', { name: 'Password' })
    await fill(form, '', 'short')
    expect(await within(form).findByText('Enter your current password')).toBeInTheDocument()
    expect(within(form).getByText('Use at least 8 characters')).toBeInTheDocument()
    expect(state.calls).toEqual([])
  })

  it('a wrong current password is shown under that field and you stay signed in', async () => {
    const { state } = open()
    server.use(http.patch(`${BASE}/api/users/me/password`, () => problem(400, 'Current password is incorrect')))
    const form = await screen.findByRole('form', { name: 'Password' })
    await fill(form, 'wrongpassword', 'newpassword2')

    expect(await within(form).findByText('Current password is incorrect')).toBeInTheDocument()
    expect(state.loggedOut).toBe(0)
    expect(tokens.getRefresh()).not.toBeNull()
  })
})

describe('privacy', () => {
  it('protects the account at once, and says so', async () => {
    const { state, record } = open()
    server.use(http.patch(`${BASE}/api/users/me`, async ({ request }) => {
      await record(request)
      return HttpResponse.json({ ...me, protectedAccount: true })
    }))
    const toggle = await screen.findByRole('switch', { name: 'Protect my account' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(toggle)

    expect(await screen.findByText('Your account is now protected.')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(state.calls[0].body).toEqual({ protectedAccount: true })
  })

  it('saves who can message you, and puts the choice back when saving fails', async () => {
    const { state, record } = open()
    server.use(http.patch(`${BASE}/api/users/me`, async ({ request }) => {
      await record(request)
      return HttpResponse.json({ ...me, dmPolicy: 'FOLLOWED' })
    }))
    const select = await screen.findByRole('combobox', { name: 'Who can message me' })
    expect(select).toHaveValue('EVERYONE')

    await userEvent.selectOptions(select, 'FOLLOWED')

    expect(await screen.findByText('Message settings saved.')).toBeInTheDocument()
    expect(select).toHaveValue('FOLLOWED')
    expect(state.calls[0].body).toEqual({ dmPolicy: 'FOLLOWED' })

    server.use(http.patch(`${BASE}/api/users/me`, () => problem(500, 'Database is down')))
    await userEvent.selectOptions(select, 'NOBODY')
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
    expect(select).toHaveValue('FOLLOWED')
  })

  it('flips back and shows the reason when saving fails', async () => {
    open()
    server.use(http.patch(`${BASE}/api/users/me`, () => problem(500, 'Database is down')))
    const toggle = await screen.findByRole('switch', { name: 'Protect my account' })
    await userEvent.click(toggle)
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })
})

describe('muted words', () => {
  function serveWords(initial: Array<{ id: number; word: string }> = []) {
    const state = { words: [...initial], posted: [] as unknown[], deleted: [] as string[] }
    server.use(
      http.get(`${BASE}/api/muted-words`, () => HttpResponse.json(state.words.map((w) => ({ ...w, createdAt: '2026-01-01T00:00:00Z' })))),
      http.post(`${BASE}/api/muted-words`, async ({ request }) => {
        const body = (await request.json()) as { word: string }
        state.posted.push(body)
        const added = { id: 100 + state.words.length, word: body.word.toLowerCase() }
        state.words = [added, ...state.words]
        return HttpResponse.json({ ...added, createdAt: '2026-01-01T00:00:00Z' }, { status: 201 })
      }),
      http.delete(`${BASE}/api/muted-words/:id`, ({ params }) => {
        state.deleted.push(String(params.id))
        state.words = state.words.filter((w) => String(w.id) !== params.id)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    return state
  }

  it('lists the words, adds one, and removes one', async () => {
    const state = serveWords([{ id: 1, word: 'spoiler' }])
    open()
    const section = await screen.findByRole('region', { name: 'Muted words' })
    expect(await within(section).findByText('spoiler')).toBeInTheDocument()

    await userEvent.type(within(section).getByLabelText('Word or phrase'), 'Pine Apple')
    await userEvent.click(within(section).getByRole('button', { name: 'Mute' }))
    expect(await within(section).findByText('pine apple')).toBeInTheDocument()
    expect(state.posted).toEqual([{ word: 'Pine Apple' }])
    expect(within(section).getByLabelText('Word or phrase')).toHaveValue('')

    await userEvent.click(within(section).getByRole('button', { name: 'Unmute spoiler' }))
    await waitFor(() => expect(within(section).queryByText('spoiler')).not.toBeInTheDocument())
    expect(state.deleted).toEqual(['1'])
  })

  it('says when there are none, and will not add an empty word', async () => {
    const state = serveWords()
    open()
    const section = await screen.findByRole('region', { name: 'Muted words' })
    expect(await within(section).findByText('You have not muted any words.')).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Mute' })).toBeDisabled()
    expect(state.posted).toEqual([])
  })

  it('shows the server reason when a word is refused', async () => {
    serveWords()
    server.use(http.post(`${BASE}/api/muted-words`, () => problem(400, 'You can mute at most 200 words')))
    open()
    const section = await screen.findByRole('region', { name: 'Muted words' })
    await userEvent.type(within(section).getByLabelText('Word or phrase'), 'one more')
    await userEvent.click(within(section).getByRole('button', { name: 'Mute' }))
    expect(await screen.findByText('You can mute at most 200 words')).toBeInTheDocument()
  })
})

describe('blocked and muted accounts', () => {
  const zed = makeUser({ id: 61, username: 'zed', displayName: 'Zed Blocked' })
  const yan = makeUser({ id: 62, username: 'yan', displayName: 'Yan Muted' })

  it('lists them with the way to undo, and says when there are none', async () => {
    open({ blocks: [zed] })
    const blocked = await screen.findByRole('region', { name: 'Blocked accounts' })
    expect(await within(blocked).findByText('Zed Blocked')).toBeInTheDocument()
    expect(within(blocked).getByRole('link', { name: /Zed Blocked/ })).toHaveAttribute('href', '/u/zed')
    const muted = screen.getByRole('region', { name: 'Muted accounts' })
    expect(await within(muted).findByText('You have not muted anyone')).toBeInTheDocument()
  })

  it('unblocks, removing the row and telling you', async () => {
    const { state } = open({ blocks: [zed] })
    await userEvent.click(await screen.findByRole('button', { name: 'Unblock @zed' }))

    expect(await screen.findByText('Unblocked @zed.')).toBeInTheDocument()
    expect(screen.queryByText('Zed Blocked')).not.toBeInTheDocument()
    expect(state.calls).toEqual([{ method: 'DELETE', path: '/api/users/zed/block', body: undefined }])
    expect(await screen.findByText('You have not blocked anyone')).toBeInTheDocument()
  })

  it('unmutes the same way', async () => {
    const { state } = open({ mutes: [yan] })
    await userEvent.click(await screen.findByRole('button', { name: 'Unmute @yan' }))
    expect(await screen.findByText('Unmuted @yan.')).toBeInTheDocument()
    expect(state.calls).toEqual([{ method: 'DELETE', path: '/api/users/yan/mute', body: undefined }])
  })

  it('keeps the row and shows the reason when it fails', async () => {
    open({ blocks: [zed] })
    server.use(http.delete(`${BASE}/api/users/zed/block`, () => problem(500, 'Could not unblock right now')))
    await userEvent.click(await screen.findByRole('button', { name: 'Unblock @zed' }))
    expect(await screen.findByText('Could not unblock right now')).toBeInTheDocument()
    expect(screen.getByText('Zed Blocked')).toBeInTheDocument()
  })
})

describe('deactivating and deleting', () => {
  it('asks before deactivating; cancelling changes nothing', async () => {
    const { state } = open()
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate your account?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(state.calls).toEqual([])
    expect(state.loggedOut).toBe(0)
  })

  it('deactivates, explains how to come back, and signs out', async () => {
    const { state, record } = open()
    server.use(http.post(`${BASE}/api/users/me/deactivate`, async ({ request }) => {
      await record(request)
      return new HttpResponse(null, { status: 204 })
    }))
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Deactivate your account?' })).getByRole('button', { name: 'Deactivate' }))

    expect(await screen.findByText(/Sign in again whenever you want it back/)).toBeInTheDocument()
    await waitFor(() => expect(state.loggedOut).toBe(1))
    expect(state.calls).toEqual([{ method: 'POST', path: '/api/users/me/deactivate', body: undefined }])
  })

  it('will not delete until the username is typed, and needs the password', async () => {
    const { state } = open()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account?' })
    const confirm = within(dialog).getByRole('button', { name: 'Delete account' })
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Type alice to confirm'), 'alic')
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Type alice to confirm'), 'e')
    expect(confirm).toBeEnabled()

    await userEvent.click(confirm) // no password yet

    expect(await within(dialog).findByText('Enter your password')).toBeInTheDocument()
    expect(state.calls).toEqual([])
  })

  it('shows a wrong password in the dialog and leaves the account alone', async () => {
    const { state } = open()
    server.use(http.delete(`${BASE}/api/users/me`, () => problem(400, 'Current password is incorrect')))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account?' })
    await userEvent.type(within(dialog).getByLabelText('Your password'), 'wrong')
    await userEvent.type(within(dialog).getByLabelText('Type alice to confirm'), 'alice')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }))

    expect(await within(dialog).findByText('Current password is incorrect')).toBeInTheDocument()
    expect(state.loggedOut).toBe(0)
  })

  it('deletes with the password and signs out', async () => {
    const { state, record } = open()
    server.use(http.delete(`${BASE}/api/users/me`, async ({ request }) => {
      await record(request)
      return new HttpResponse(null, { status: 204 })
    }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete your account?' })
    await userEvent.type(within(dialog).getByLabelText('Your password'), 'secret-pass')
    await userEvent.type(within(dialog).getByLabelText('Type alice to confirm'), 'alice')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }))

    expect(await screen.findByText('Your account was deleted.')).toBeInTheDocument()
    expect(state.calls).toEqual([{ method: 'DELETE', path: '/api/users/me', body: { password: 'secret-pass' } }])
    await waitFor(() => expect(state.loggedOut).toBe(1))
  })
})

describe('email delivery check (admins)', () => {
  const openAs = (admin: boolean) => {
    const fake = serve()
    renderSignedIn(<SettingsPage />, { route: '/settings', user: { admin } })
    return fake
  }

  it('is not offered to anyone else', async () => {
    openAs(false)
    await screen.findByRole('form', { name: 'Username' })
    expect(screen.queryByRole('region', { name: 'Email delivery' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send test email' })).not.toBeInTheDocument()
  })

  it('sends one test email to your own address and says the mail server accepted it', async () => {
    const { state, record } = openAs(true)
    server.use(http.post(`${BASE}/api/admin/email/test`, async ({ request }) => {
      await record(request)
      return new HttpResponse(null, { status: 204 })
    }))
    const section = await screen.findByRole('region', { name: 'Email delivery' })
    expect(section).toHaveTextContent('alice@example.com')

    await userEvent.click(within(section).getByRole('button', { name: 'Send test email' }))

    expect(await within(section).findByText(/Sent to alice@example.com: the mail server accepted it/)).toBeInTheDocument()
    expect(state.calls).toEqual([{ method: 'POST', path: '/api/admin/email/test', body: undefined }])
  })

  it('shows the mail server\'s own reason when it refuses, and nothing like "sent"', async () => {
    openAs(true)
    server.use(http.post(`${BASE}/api/admin/email/test`, () => problem(502, 'The mail server did not accept the message: 535-5.7.8 Username and Password not accepted.')))
    const section = await screen.findByRole('region', { name: 'Email delivery' })

    await userEvent.click(within(section).getByRole('button', { name: 'Send test email' }))

    expect(await within(section).findByRole('alert')).toHaveTextContent('535-5.7.8 Username and Password not accepted')
    expect(within(section).queryByRole('status')).not.toBeInTheDocument()
  })

  it('tells you when email is not configured at all', async () => {
    openAs(true)
    server.use(http.post(`${BASE}/api/admin/email/test`, () => problem(409, 'Email is not configured: set SPRING_MAIL_HOST (and the port, username and password) and restart the backend.')))
    const section = await screen.findByRole('region', { name: 'Email delivery' })

    await userEvent.click(within(section).getByRole('button', { name: 'Send test email' }))

    expect(await within(section).findByRole('alert')).toHaveTextContent('Email is not configured: set SPRING_MAIL_HOST')
  })

  it('a second try clears the previous result first', async () => {
    openAs(true)
    let calls = 0
    server.use(http.post(`${BASE}/api/admin/email/test`, () => (++calls === 1 ? problem(502, 'First failure') : new HttpResponse(null, { status: 204 }))))
    const section = await screen.findByRole('region', { name: 'Email delivery' })

    await userEvent.click(within(section).getByRole('button', { name: 'Send test email' }))
    expect(await within(section).findByText('First failure')).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: 'Send test email' }))

    expect(await within(section).findByRole('status')).toBeInTheDocument()
    expect(within(section).queryByText('First failure')).not.toBeInTheDocument()
  })
})
