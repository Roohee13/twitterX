import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { BASE, authResponse, me, renderApp, server } from '../../test/render'
import { useAuth } from './AuthContext'
import { ForgotPasswordPage } from './ForgotPasswordPage'
import { ResetPasswordPage } from './ResetPasswordPage'
import { VerificationBanner } from './VerificationBanner'
import { VerifyEmailPage } from './VerifyEmailPage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

describe('ForgotPasswordPage', () => {
  it('always shows the same message and never says whether the account exists', async () => {
    const body = vi.fn()
    server.use(http.post(`${BASE}/api/auth/forgot-password`, async ({ request }) => (body(await request.json()), new HttpResponse(null, { status: 204 }))))
    renderApp(<Routes><Route path="/forgot-password" element={<ForgotPasswordPage />} /></Routes>, { route: '/forgot-password' })

    await userEvent.type(screen.getByLabelText('Email'), 'nobody@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('status')).toHaveTextContent("If an account exists for nobody@example.com, we've sent a link")
    expect(body).toHaveBeenCalledWith({ email: 'nobody@example.com' })
  })

  it('rejects an invalid address without calling the API', async () => {
    renderApp(<Routes><Route path="/forgot-password" element={<ForgotPasswordPage />} /></Routes>, { route: '/forgot-password' })

    await userEvent.type(screen.getByLabelText('Email'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
  })
})

describe('ResetPasswordPage', () => {
  const renderReset = (search = '?token=abc123') =>
    renderApp(<Routes><Route path="/reset-password" element={<ResetPasswordPage />} /></Routes>, { route: `/reset-password${search}` })

  it('explains an incomplete link', () => {
    renderReset('')
    expect(screen.getByText('This link is incomplete')).toBeInTheDocument()
  })

  it('checks that both passwords match before calling the API', async () => {
    renderReset()
    await userEvent.type(screen.getByLabelText('New password'), 'password123')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'different123')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByText("The passwords don't match")).toBeInTheDocument()
  })

  it('changes the password with the token from the link', async () => {
    let body: unknown
    server.use(http.post(`${BASE}/api/auth/reset-password`, async ({ request }) => ((body = await request.json()), new HttpResponse(null, { status: 204 }))))
    renderReset()

    await userEvent.type(screen.getByLabelText('New password'), 'password123')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Password changed')).toBeInTheDocument()
    expect(body).toEqual({ token: 'abc123', newPassword: 'password123' })
  })

  it('offers a new link when the token is rejected', async () => {
    server.use(http.post(`${BASE}/api/auth/reset-password`, () => HttpResponse.json({ status: 400, detail: 'Invalid or expired token' }, { status: 400 })))
    renderReset()

    await userEvent.type(screen.getByLabelText('New password'), 'password123')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('This link has expired')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password')
  })
})

describe('VerifyEmailPage', () => {
  const renderVerify = (strict = false) =>
    renderApp(<Routes><Route path="/verify-email" element={<VerifyEmailPage />} /></Routes>, { route: '/verify-email?token=tok-1', strict })

  it('uses the token exactly once, even when React runs the effect twice (StrictMode)', async () => {
    const calls = vi.fn()
    server.use(http.post(`${BASE}/api/auth/verify-email`, () => (calls(), new HttpResponse(null, { status: 204 }))))

    renderVerify(true)

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('shows why verification failed', async () => {
    server.use(http.post(`${BASE}/api/auth/verify-email`, () => HttpResponse.json({ status: 400, detail: 'Invalid or expired token' }, { status: 400 })))

    renderVerify()

    expect(await screen.findByText("We couldn't verify your email")).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid or expired token')
  })

  it('refreshes the signed-in user afterwards so the banner can go away', async () => {
    localStorage.setItem('xclone.refreshToken', 'refresh-1')
    const meCalls = vi.fn()
    server.use(
      http.post(`${BASE}/api/auth/refresh`, () => HttpResponse.json(authResponse())),
      http.get(`${BASE}/api/users/me`, () => (meCalls(), HttpResponse.json({ ...me, emailVerified: true }))),
      http.post(`${BASE}/api/auth/verify-email`, () => new HttpResponse(null, { status: 204 })),
    )

    renderVerify()

    expect(await screen.findByText('Email verified')).toBeInTheDocument()
    await waitFor(() => expect(meCalls.mock.calls.length).toBeGreaterThanOrEqual(2)) // session restore + the refresh after verifying
  })
})

describe('VerificationBanner', () => {
  function Gate() {
    const { status } = useAuth()
    return status === 'authenticated' ? <VerificationBanner /> : <p>waiting</p>
  }

  function signedInUnverified(extra: Parameters<typeof server.use> = []) {
    localStorage.setItem('xclone.refreshToken', 'refresh-1')
    server.use(
      http.post(`${BASE}/api/auth/refresh`, () => HttpResponse.json(authResponse({ emailVerified: false }))),
      http.get(`${BASE}/api/users/me`, () => HttpResponse.json({ ...me, emailVerified: false })),
      ...extra,
    )
  }

  it('is hidden for verified users', async () => {
    localStorage.setItem('xclone.refreshToken', 'refresh-1')
    server.use(
      http.post(`${BASE}/api/auth/refresh`, () => HttpResponse.json(authResponse())),
      http.get(`${BASE}/api/users/me`, () => HttpResponse.json(me)),
    )
    renderApp(<Gate />)
    await waitFor(() => expect(screen.queryByText('waiting')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Verify your email' })).not.toBeInTheDocument()
  })

  it('sends a new link when asked', async () => {
    const sent = vi.fn()
    signedInUnverified([http.post(`${BASE}/api/users/me/verify-email`, () => (sent(), new HttpResponse(null, { status: 204 })))])
    renderApp(<Gate />)

    await userEvent.click(await screen.findByRole('button', { name: 'Resend email' }))

    expect(await screen.findByText(`We sent a new link to ${me.email}.`)).toBeInTheDocument()
    expect(sent).toHaveBeenCalledTimes(1)
  })

  it('treats "already verified" as success and refreshes the user', async () => {
    localStorage.setItem('xclone.refreshToken', 'refresh-1')
    let verified = false
    server.use(
      http.post(`${BASE}/api/auth/refresh`, () => HttpResponse.json(authResponse({ emailVerified: false }))),
      http.get(`${BASE}/api/users/me`, () => HttpResponse.json({ ...me, emailVerified: verified })),
      http.post(`${BASE}/api/users/me/verify-email`, () => {
        verified = true // verified in another tab meanwhile
        return HttpResponse.json({ status: 409, detail: 'Email is already verified' }, { status: 409 })
      }),
    )
    renderApp(<Gate />)

    await userEvent.click(await screen.findByRole('button', { name: 'Resend email' }))

    expect(await screen.findByText('Your email is already verified.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Verify your email' })).not.toBeInTheDocument())
  })
})
