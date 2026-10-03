import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ApiError, api } from '../../lib/api'
import { AuthLayout, FormError } from './AuthLayout'
import { validateEmail } from './validation'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const problem = validateEmail(email)
    setError(problem)
    if (problem) return

    setSubmitting(true)
    try {
      await api.post('/api/auth/forgot-password', { email: email.trim() }, { auth: false })
      setSent(true)
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const back = (
    <Link to="/login" className="font-semibold text-brand hover:underline">
      Back to sign in
    </Link>
  )

  if (sent) {
    return (
      <AuthLayout title="Check your email" footer={back}>
        {/* The API answers the same way for every address, so this never reveals whether an account exists. */}
        <p role="status" className="text-center text-zinc-300">
          If an account exists for <strong>{email.trim()}</strong>, we've sent a link to reset the password. It is valid for one hour.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Reset your password" footer={back}>
      <p className="mb-4 text-center text-zinc-400">Enter the email you signed up with and we'll send you a reset link.</p>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" autoFocus value={email} error={error} onChange={(e) => setEmail(e.target.value)} />
        <FormError message={formError} />
        <Button type="submit" loading={submitting} className="w-full py-3">
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  )
}
