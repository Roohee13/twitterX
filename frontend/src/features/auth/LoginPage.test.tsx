import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { BASE, authResponse, renderApp, server } from '../../test/render'
import { GuestOnly } from './guards'
import { LoginPage } from './LoginPage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

function renderLogin(route: string | { pathname: string; state: unknown } = '/login') {
  return renderApp(
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      <Route path="/" element={<p>home page</p>} />
      <Route path="/inbox" element={<p>inbox page</p>} />
    </Routes>,
    { route },
  )
}

describe('LoginPage', () => {
  it('asks for missing fields without calling the API', async () => {
    const called = vi.fn()
    server.use(http.post(`${BASE}/api/auth/login`, () => (called(), HttpResponse.json(authResponse()))))
    renderLogin()

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByText('Enter your username or email')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    expect(called).not.toHaveBeenCalled()
  })

  it('shows the server message for wrong credentials and stays on the page', async () => {
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ title: 'Unauthorized', status: 401, detail: 'Invalid credentials' }, { status: 401 }),
      ),
    )
    renderLogin()

    await userEvent.type(screen.getByLabelText('Username or email'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled() // can try again
    expect(tokens.getRefresh()).toBeNull()
  })

  it('signs in and goes back to the page the visitor was sent away from', async () => {
    let body: unknown
    server.use(
      http.post(`${BASE}/api/auth/login`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(authResponse())
      }),
    )
    renderLogin({ pathname: '/login', state: { from: '/inbox' } })

    await userEvent.type(screen.getByLabelText('Username or email'), '  alice  ')
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('inbox page')).toBeInTheDocument()
    expect(body).toEqual({ usernameOrEmail: 'alice', password: 'password123' })
    expect(tokens.getRefresh()).toBe('refresh-1')
  })

  it('ignores a "from" that points outside the app', async () => {
    server.use(http.post(`${BASE}/api/auth/login`, () => HttpResponse.json(authResponse())))
    renderLogin({ pathname: '/login', state: { from: '//evil.example' } })

    await userEvent.type(screen.getByLabelText('Username or email'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('home page')).toBeInTheDocument()
  })

  it('can show and hide the password', async () => {
    renderLogin()
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
  })
})

describe('LoginPage links', () => {
  it('links to register and forgot-password', async () => {
    renderLogin()
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register'))
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
  })
})
