import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { ApiError } from '../../lib/api'
import { useAuth } from './AuthContext'
import { AuthLayout, FormError } from './AuthLayout'
import { validateRegistration, type FieldErrors, type RegistrationFields } from './validation'

type Errors = FieldErrors<keyof RegistrationFields>

/** Puts a server rejection under the field it is about; anything unrecognised becomes a form-level message. */
function serverErrors(e: unknown): { fields: Errors; form: string | null } {
  if (!(e instanceof ApiError)) return { fields: {}, form: 'Something went wrong. Please try again.' }
  const fields: Errors = {}
  for (const key of ['username', 'email', 'displayName', 'password'] as const) {
    if (e.fieldErrors[key]) fields[key] = e.fieldErrors[key]
  }
  if (e.status === 409) {
    fields[/username/i.test(e.message) ? 'username' : 'email'] = e.message
  }
  return { fields, form: Object.keys(fields).length > 0 ? null : e.message }
}

export function RegisterPage() {
  const { register } = useAuth()
  const [values, setValues] = useState<RegistrationFields>({ username: '', email: '', displayName: '', password: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = (key: keyof RegistrationFields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }))
    setErrors((current) => ({ ...current, [key]: undefined })) // editing a field clears its message
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const found = validateRegistration(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return

    setSubmitting(true)
    try {
      await register({ ...values, username: values.username.trim(), email: values.email.trim(), displayName: values.displayName.trim() })
    } catch (e) {
      const { fields, form } = serverErrors(e)
      setErrors(fields)
      setFormError(form)
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field label="Name" name="displayName" autoComplete="name" autoFocus value={values.displayName} error={errors.displayName} onChange={set('displayName')} />
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          hint="3-15 letters, digits or underscores"
          value={values.username}
          error={errors.username}
          onChange={set('username')}
        />
        <Field label="Email" name="email" type="email" autoComplete="email" value={values.email} error={errors.email} onChange={set('email')} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters"
          value={values.password}
          error={errors.password}
          onChange={set('password')}
        />
        <FormError message={formError} />
        <Button type="submit" loading={submitting} className="w-full py-3">
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
