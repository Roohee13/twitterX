import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import { useCurrentUser, useAuth } from './AuthContext'

/** Shown above every signed-in page until the email address is confirmed. */
export function VerificationBanner() {
  const user = useCurrentUser()
  const { refreshUser } = useAuth()
  const toast = useToast()
  const [sending, setSending] = useState(false)

  if (user.emailVerified) return null

  async function resend() {
    setSending(true)
    try {
      await api.post('/api/users/me/verify-email')
      toast(`We sent a new link to ${user.email}.`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast('Your email is already verified.')
        await refreshUser().catch(() => undefined)
      } else {
        toast(e instanceof ApiError ? e.message : 'Could not send the email. Please try again.', 'error')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div role="region" aria-label="Verify your email" className="flex flex-wrap items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <p className="min-w-0 flex-1">
        Please verify your email address. We sent a link to <strong>{user.email}</strong>.
      </p>
      <Button size="sm" variant="secondary" loading={sending} onClick={() => void resend()}>
        Resend email
      </Button>
    </div>
  )
}
