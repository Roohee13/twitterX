import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Spinner } from '../../components/ui/Spinner'
import { ApiError, api } from '../../lib/api'
import { useAuth } from './AuthContext'
import { AuthLayout } from './AuthLayout'

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const { status, refreshUser } = useAuth()
  const [state, setState] = useState<'verifying' | 'done' | 'failed'>(token ? 'verifying' : 'failed')
  const [message, setMessage] = useState('This link is incomplete.')
  // The token works once. React StrictMode runs effects twice in development, and a second call would report the
  // first one's success as "already used", so the request is guarded to go out exactly once per page load.
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    api
      .post('/api/auth/verify-email', { token }, { auth: false })
      .then(() => setState('done'))
      .catch((e: unknown) => {
        setMessage(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
        setState('failed')
      })
  }, [token])

  // Signed in on this device: update the cached user so the "verify your email" banner goes away.
  useEffect(() => {
    if (state === 'done' && status === 'authenticated') void refreshUser().catch(() => undefined)
  }, [state, status, refreshUser])

  const home = (
    <Link to="/" className="font-semibold text-brand hover:underline">
      {status === 'authenticated' ? 'Go to your timeline' : 'Sign in'}
    </Link>
  )

  if (state === 'verifying') {
    return <AuthLayout title="Verifying your email"><Spinner label="Verifying" /></AuthLayout>
  }
  if (state === 'done') {
    return (
      <AuthLayout title="Email verified" footer={home}>
        <p role="status" className="text-center text-zinc-300">Thanks, your email address is confirmed.</p>
      </AuthLayout>
    )
  }
  return (
    <AuthLayout title="We couldn't verify your email" footer={home}>
      <p role="alert" className="text-center text-zinc-400">
        {message} Sign in and use "Resend email" to get a new link.
      </p>
    </AuthLayout>
  )
}
