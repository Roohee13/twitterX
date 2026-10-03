import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ApiError, api } from '../../lib/api'
import { AuthLayout, FormError } from './AuthLayout'
import { validatePassword } from './validation'

const requestNewLink = (
  <Link to="/forgot-password" className="font-semibold text-brand hover:underline">
    Request a new link
  </Link>
)

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [state, setState] = useState<'form' | 'done' | 'invalid'>('form')

  if (!token) {
    return (
      <AuthLayout title="This link is incomplete" footer={requestNewLink}>
        <p className="text-center text-zinc-400">Open the full link from the email, or ask for a new one.</p>
      </AuthLayout>
    )
  }

  if (state === 'invalid') {
    return (
      <AuthLayout title="This link has expired" footer={requestNewLink}>
        <p role="alert" className="text-center text-zinc-400">The reset link is invalid, already used, or older than an hour.</p>
      </AuthLayout>
    )
  }

  if (state === 'done') {
    return (
      <AuthLayout
        title="Password changed"
        footer={<Link to="/login" className="font-semibold text-brand hover:underline">Sign in</Link>}
      >
        <p role="status" className="text-center text-zinc-300">You were signed out everywhere. Sign in with your new password.</p>
      </AuthLayout>
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const next = { password: validatePassword(password), confirm: password === confirm ? undefined : "The passwords don't match" }
    setErrors(next)
    if (next.password || next.confirm) return

    setSubmitting(true)
    try {
      await api.post('/api/auth/reset-password', { token, newPassword: password }, { auth: false })
      setState('done')
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && !e.fieldErrors.newPassword) setState('invalid')
      else if (e instanceof ApiError && e.fieldErrors.newPassword) setErrors({ password: e.fieldErrors.newPassword })
      else setFormError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="New password" name="password" type="password" autoComplete="new-password" autoFocus hint="At least 8 characters" value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" value={confirm} error={errors.confirm} onChange={(e) => setConfirm(e.target.value)} />
        <FormError message={formError} />
        <Button type="submit" loading={submitting} className="w-full py-3">
          Change password
        </Button>
      </form>
    </AuthLayout>
  )
}
