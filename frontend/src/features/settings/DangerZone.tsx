import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Field } from '../../components/ui/Field'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import { useAuth, useCurrentUser } from '../auth/AuthContext'

function DeleteDialog({ onClose }: { onClose: () => void }) {
  const user = useCurrentUser()
  const { logout } = useAuth()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!password) return setError('Enter your password')
    setBusy(true)
    try {
      await api.delete('/api/users/me', { body: { password } })
      toast('Your account was deleted.')
      await logout()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not delete the account. Please try again.')
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Delete your account?">
      <div className="space-y-3 text-zinc-400">
        <p>This permanently erases your profile, posts, likes, bookmarks and follows. It <strong className="text-zinc-100">cannot be undone</strong> and your username will not come back.</p>
        <Field label="Your password" name="password" type="password" autoComplete="current-password" value={password} error={error}
          onChange={(e) => { setPassword(e.target.value); setError(undefined) }} />
        <Field label={`Type ${user.username} to confirm`} name="confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} disabled={typed !== user.username} onClick={() => void remove()}>Delete account</Button>
      </div>
    </Modal>
  )
}

/** Deactivating is reversible (signing in again undoes it); deleting is not. */
export function DangerZone() {
  const { logout } = useAuth()
  const toast = useToast()
  const [dialog, setDialog] = useState<'deactivate' | 'delete' | null>(null)

  async function deactivate(): Promise<boolean> {
    try {
      await api.post('/api/users/me/deactivate')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not deactivate the account.', 'error')
      return false
    }
    toast('Your account is deactivated. Sign in again whenever you want it back.')
    await logout()
    return true
  }

  return (
    <section aria-label="Deactivate or delete" className="space-y-4 px-4 py-5">
      <h3 className="text-lg font-bold text-red-400">Leaving</h3>
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <p className="font-semibold">Deactivate account</p>
          <p className="text-sm text-zinc-500">Hides your account and signs you out everywhere. Nothing is deleted, and signing in again reactivates it.</p>
        </div>
        <Button variant="secondary" onClick={() => setDialog('deactivate')}>Deactivate</Button>
      </div>
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <p className="font-semibold">Delete account</p>
          <p className="text-sm text-zinc-500">Permanently erases your data. This cannot be undone.</p>
        </div>
        <Button variant="danger" onClick={() => setDialog('delete')}>Delete account</Button>
      </div>
      {dialog === 'deactivate' && (
        <ConfirmDialog title="Deactivate your account?" confirmLabel="Deactivate" danger onConfirm={deactivate} onClose={() => setDialog(null)}>
          Your profile and posts are hidden and you are signed out on every device. Sign in again at any time to bring everything back.
        </ConfirmDialog>
      )}
      {dialog === 'delete' && <DeleteDialog onClose={() => setDialog(null)} />}
    </section>
  )
}
