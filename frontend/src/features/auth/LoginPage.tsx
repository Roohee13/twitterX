import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ApiError } from '../../lib/api'
import { useAuth } from './AuthContext'
import { AuthLayout, FormError } from './AuthLayout'

export function LoginPage() {
  const { login } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const next = {
      identifier: identifier.trim() ? undefined : 'Enter your username or email',
      password: password ? undefined : 'Enter your password',
    }
    setErrors(next)
    setFormError(null)
    if (next.identifier || next.password) return

    setSubmitting(true)
    try {
      // On success the guard around this route sends the user to the page they came from (or home).
      await login(identifier.trim(), password)
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in to XClone"
      footer={
        <>
          Don't have an account?{' '}
          <Link to="/register" className="font-semibold text-brand hover:underline">
            Sign up
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="Username or email"
          name="identifier"
          autoComplete="username"
          autoFocus
          value={identifier}
          error={errors.identifier}
          onChange={(e) => setIdentifier(e.target.value)}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          error={errors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError message={formError} />
        <Button type="submit" loading={submitting} className="w-full py-3">
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-brand hover:underline">
            Forgot password?
          </Link>
        </p>
      </form>
    </AuthLayout>
  )
}
