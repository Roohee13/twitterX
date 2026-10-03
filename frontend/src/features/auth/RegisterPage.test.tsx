import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { BASE, authResponse, renderApp, server } from '../../test/render'
import { GuestOnly } from './guards'
import { RegisterPage } from './RegisterPage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

function renderRegister() {
  return renderApp(
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route path="/" element={<p>home page</p>} />
    </Routes>,
    { route: '/register' },
  )
}

async function fill(values: { name?: string; username?: string; email?: string; password?: string }) {
  const { name = 'Alice', username = 'alice', email = 'alice@example.com', password = 'password123' } = values
  await userEvent.type(screen.getByLabelText('Name'), name)
  await userEvent.type(screen.getByLabelText('Username'), username)
  await userEvent.type(screen.getByLabelText('Email'), email)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
}

describe('RegisterPage', () => {
  it('catches mistakes before calling the API, field by field', async () => {
    const called = vi.fn()
    server.use(http.post(`${BASE}/api/auth/register`, () => (called(), HttpResponse.json(authResponse(), { status: 201 }))))
    renderRegister()

    await fill({ username: 'a!', email: 'nope', password: 'short' })

    expect(screen.getByText('Use 3-15 letters, digits or underscores')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByText('Use at least 8 characters')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true')
    expect(called).not.toHaveBeenCalled()
  })

  it('clears a field message as soon as the field is edited', async () => {
    renderRegister()
    await fill({ username: 'a!' })
    expect(screen.getByText('Use 3-15 letters, digits or underscores')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Username'), 'b')

    expect(screen.queryByText('Use 3-15 letters, digits or underscores')).not.toBeInTheDocument()
  })

  it('shows API validation errors under the field they belong to', async () => {
    server.use(
      http.post(`${BASE}/api/auth/register`, () =>
        HttpResponse.json({ title: 'Bad Request', status: 400, detail: 'Validation failed', errors: { displayName: 'size must be between 1 and 50' } }, { status: 400 }),
      ),
    )
    renderRegister()

    await fill({})

    expect(await screen.findByText('size must be between 1 and 50')).toBeInTheDocument()
    expect(screen.queryByText('Validation failed')).not.toBeInTheDocument()
  })

  it.each([
    ['Username is already taken', 'Username'],
    ['Email is already registered', 'Email'],
  ])('puts the 409 "%s" under the %s field', async (detail, label) => {
    server.use(http.post(`${BASE}/api/auth/register`, () => HttpResponse.json({ title: 'Conflict', status: 409, detail }, { status: 409 })))
    renderRegister()

    await fill({})

    const message = await screen.findByText(detail)
    expect(screen.getByLabelText(label)).toHaveAccessibleDescription(detail)
    expect(message).toBeInTheDocument()
  })

  it('creates the account, signs in and goes home', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE}/api/auth/register`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(authResponse({ emailVerified: false }), { status: 201 })
      }),
    )
    renderRegister()

    await fill({ name: '  Alice A  ' })

    expect(await screen.findByText('home page')).toBeInTheDocument()
    expect(body).toEqual({ username: 'alice', email: 'alice@example.com', displayName: 'Alice A', password: 'password123' })
    expect(tokens.getRefresh()).toBe('refresh-1')
  })
})
