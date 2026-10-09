import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { setupServer } from 'msw/node'
import type { ReactElement } from 'react'
import { StrictMode } from 'react'
import { MemoryRouter, type InitialEntry } from 'react-router'
import { ToastProvider } from '../components/ui/Toast'
import { http, HttpResponse } from 'msw'
import { AuthProvider, useAuth } from '../features/auth/AuthContext'

export const BASE = 'http://api.test'
export const server = setupServer()

export const me = {
  id: 1,
  username: 'alice',
  email: 'alice@example.com',
  emailVerified: true,
  displayName: 'Alice',
  bio: null,
  avatarUrl: null,
  bannerUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
  protectedAccount: false,
  admin: false,
  dmPolicy: 'EVERYONE',
}

export function authResponse(overrides: Partial<typeof me> = {}) {
  return { accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 60, user: { ...me, ...overrides } }
}

/** Renders inside the same providers as the real app, with the fake API as the backend. */
export function renderApp(ui: ReactElement, options: { route?: InitialEntry; strict?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[options.route ?? '/']}>
          <AuthProvider>{ui}</AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)
}

function SignedInGate({ children }: { children: ReactElement }) {
  const { status } = useAuth()
  return status === 'authenticated' ? children : <p>restoring session</p>
}

/** Like renderApp, but with a signed-in user: stores a refresh token, answers the session restore and renders `ui` once it is done. */
export function renderSignedIn(ui: ReactElement, options: { route?: InitialEntry; user?: Partial<typeof me> } = {}) {
  localStorage.setItem('xclone.refreshToken', 'refresh-1')
  const user = { ...me, ...options.user }
  server.use(
    http.post(`${BASE}/api/auth/refresh`, () => HttpResponse.json(authResponse(options.user))),
    http.get(`${BASE}/api/users/me`, () => HttpResponse.json(user)),
  )
  return renderApp(<SignedInGate>{ui}</SignedInGate>, options)
}
