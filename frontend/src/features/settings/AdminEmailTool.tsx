import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ApiError, api } from '../../lib/api'
import { useCurrentUser } from '../auth/AuthContext'

type Outcome = { kind: 'sent' } | { kind: 'failed'; reason: string }

/**
 * For admins: sends one email to your own address right now and shows what the mail server said, so a wrong password or sender is
 * visible here instead of only in the backend log. "Sent" means the mail server accepted it; the inbox (and spam folder) is for you to check.
 */
export function AdminEmailTool() {
  const user = useCurrentUser()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  if (!user.admin) return null

  async function send() {
    setBusy(true)
    setOutcome(null)
    try {
      await api.post('/api/admin/email/test')
      setOutcome({ kind: 'sent' })
    } catch (e) {
      setOutcome({ kind: 'failed', reason: e instanceof ApiError ? e.message : 'Could not reach the server. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Email delivery" className="space-y-3 border-b border-zinc-800 px-4 py-5">
      <div>
        <h3 className="text-lg font-bold">Email delivery</h3>
        <p className="text-sm text-zinc-500">Checks that the server can send email (verification links, password resets, moderation notices). Sends one message to {user.email}.</p>
      </div>
      <Button variant="secondary" loading={busy} onClick={() => void send()}>Send test email</Button>
      {outcome?.kind === 'sent' && (
        <p role="status" className="rounded-md border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm text-green-300">
          Sent to {user.email}: the mail server accepted it. Check the inbox, and the spam folder if it is not there.
        </p>
      )}
      {outcome?.kind === 'failed' && (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{outcome.reason}</p>
      )}
    </section>
  )
}
