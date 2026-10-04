import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Field } from '../../components/ui/Field'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import type { UserResponse } from '../../lib/types'
import { useAuth, useCurrentUser } from '../auth/AuthContext'
import { validateEmail, validatePassword, validateUsername } from '../auth/validation'
import { FormCard } from './FormCard'

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.')

export function UsernameForm() {
  const user = useCurrentUser()
  const { setUser } = useAuth()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState(user.username)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setNotice(null)
    const invalid = validateUsername(username)
    if (invalid) return setError(invalid)
    if (username.trim() === user.username) return setError('That is already your username')
    setBusy(true)
    try {
      const updated = await api.patch<UserResponse>('/api/users/me/username', { username: username.trim() })
      setUser(updated)
      setUsername(updated.username)
      setError(undefined)
      setNotice(`Your username is now @${updated.username}.`)
      // Everything cached under the old name (profiles, links) is stale.
      void queryClient.invalidateQueries()
    } catch (e) {
      setError(e instanceof ApiError ? (e.fieldErrors.username ?? e.message) : messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormCard title="Username" description="Links to your profile change with it." submitLabel="Change username" busy={busy} onSubmit={() => void save()} notice={notice}>
      <Field label="Username" name="username" autoComplete="username" value={username} error={error} hint="3-15 letters, digits or underscores"
        onChange={(e) => { setUsername(e.target.value); setError(undefined) }} />
    </FormCard>
  )
}

export function EmailForm() {
  const user = useCurrentUser()
  const { setUser } = useAuth()
  const [email, setEmail] = useState(user.email)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setNotice(null)
    const invalid = validateEmail(email)
    if (invalid) return setError(invalid)
    if (email.trim().toLowerCase() === user.email.toLowerCase()) return setError('That is already your email address')
    setBusy(true)
    try {
      const updated = await api.patch<UserResponse>('/api/users/me/email', { email: email.trim() })
      setUser(updated)
      setEmail(updated.email)
      setError(undefined)
      setNotice(`We sent a link to ${updated.email}. Open it to confirm the address.`)
    } catch (e) {
      setError(e instanceof ApiError ? (e.fieldErrors.email ?? e.message) : messageOf(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormCard title="Email" description={user.emailVerified ? 'Your address is verified.' : 'Your address is not verified yet.'} submitLabel="Change email" busy={busy} onSubmit={() => void save()} notice={notice}>
      <Field label="Email" name="email" type="email" autoComplete="email" value={email} error={error}
        onChange={(e) => { setEmail(e.target.value); setError(undefined) }} />
    </FormCard>
  )
}

export function PasswordForm() {
  const { logout } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({})
  const [busy, setBusy] = useState(false)

  async function save() {
    const found = { current: current ? undefined : 'Enter your current password', next: validatePassword(next) }
    setErrors(found)
    if (found.current || found.next) return
    setBusy(true)
    try {
      await api.patch('/api/users/me/password', { currentPassword: current, newPassword: next })
      toast('Password changed. Please sign in again.')
      await logout() // the server ended every session, this one included
    } catch (e) {
      const server = e instanceof ApiError ? e : null
      setErrors({ current: server?.fieldErrors.currentPassword ?? (server?.status === 400 && /current/i.test(server.message) ? server.message : undefined), next: server?.fieldErrors.newPassword })
      if (!server?.fieldErrors.currentPassword && !server?.fieldErrors.newPassword && !(server?.status === 400 && /current/i.test(server.message))) toast(messageOf(e), 'error')
      setBusy(false)
    }
  }

  return (
    <FormCard title="Password" description="Changing it signs you out on every device." submitLabel="Change password" busy={busy} onSubmit={() => void save()}>
      <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" value={current} error={errors.current}
        onChange={(e) => { setCurrent(e.target.value); setErrors((x) => ({ ...x, current: undefined })) }} />
      <Field label="New password" name="newPassword" type="password" autoComplete="new-password" value={next} error={errors.next} hint="At least 8 characters"
        onChange={(e) => { setNext(e.target.value); setErrors((x) => ({ ...x, next: undefined })) }} />
    </FormCard>
  )
}
