import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { setupServer } from 'msw/node'
import type { ReactElement } from 'react'
import { StrictMode } from 'react'
import { MemoryRouter, type InitialEntry } from 'react-router'
import { ToastProvider } from '../components/ui/Toast'
import { AuthProvider } from '../features/auth/AuthContext'

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
