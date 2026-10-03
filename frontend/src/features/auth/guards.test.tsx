import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { AuthProvider } from './AuthContext'
import { GuestOnly, RequireAuth } from './guards'

const BASE = 'http://api.test'
const server = setupServer()
const me = { id: 1, username: 'alice', email: 'a@x.test', emailVerified: true, displayName: 'Alice', bio: null, avatarUrl: null, bannerUrl: null, createdAt: '2026-01-01T00:00:00Z', protectedAccount: false }

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <Routes>
              <Route element={<RequireAuth />}>
                <Route path="/" element={<p>private home</p>} />
              </Route>
              <Route element={<GuestOnly />}>
                <Route path="/login" element={<p>login page</p>} />
              </Route>
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('route guards', () => {
  it('sends a visitor without a session to the login page', async () => {
    renderAt('/')
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })

  it('restores a stored session and shows the private page', async () => {
    localStorage.setItem('xclone.refreshToken', 'refresh-1')
    server.use(
      http.post(`${BASE}/api/auth/refresh`, () =>
        HttpResponse.json({ accessToken: 'fresh', refreshToken: 'refresh-2', expiresIn: 60, user: me }),
      ),
      http.get(`${BASE}/api/users/me`, () => HttpResponse.json(me)),
    )

    renderAt('/')

    expect(await screen.findByText('private home')).toBeInTheDocument()
    expect(tokens.getRefresh()).toBe('refresh-2')
  })

  it('falls back to login when the stored session is no longer valid', async () => {
    localStorage.setItem('xclone.refreshToken', 'revoked')
    server.use(http.post(`${BASE}/api/auth/refresh`, () => new HttpResponse(null, { status: 401 })))

    renderAt('/')

    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(tokens.getRefresh()).toBeNull()
  })

  it('offers a retry instead of logging out when the server is unreachable', async () => {
    localStorage.setItem('xclone.refreshToken', 'refresh-1')
    server.use(http.post(`${BASE}/api/auth/refresh`, () => HttpResponse.error()))

    renderAt('/')

    expect(await screen.findByText('Cannot reach the server.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(tokens.getRefresh()).toBe('refresh-1') // the session is kept for the retry
  })
})
