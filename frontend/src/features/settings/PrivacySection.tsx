import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import type { DmPolicy, UserResponse } from '../../lib/types'
import { useAuth, useCurrentUser } from '../auth/AuthContext'

/** The protected-account switch. It saves as soon as it is flipped, and flips back if the server says no. */
export function PrivacySection() {
  const user = useCurrentUser()
  const { setUser } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const id = useId()

  const dmId = useId()
  const [dmBusy, setDmBusy] = useState(false)

  async function changeDmPolicy(wanted: DmPolicy) {
    const before = user
    setDmBusy(true)
    setUser({ ...user, dmPolicy: wanted })
    try {
      setUser(await api.patch<UserResponse>('/api/users/me', { dmPolicy: wanted }))
      toast('Message settings saved.')
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
    } catch (e) {
      setUser(before)
      toast(e instanceof ApiError ? e.message : 'Could not change that setting.', 'error')
    } finally {
      setDmBusy(false)
    }
  }

  async function toggle() {
    const wanted = !user.protectedAccount
    setBusy(true)
    setUser({ ...user, protectedAccount: wanted })
    try {
      const updated = await api.patch<UserResponse>('/api/users/me', { protectedAccount: wanted })
      setUser(updated)
      toast(wanted ? 'Your account is now protected.' : 'Your account is now public.')
      void queryClient.invalidateQueries({ queryKey: ['profile'] })
    } catch (e) {
      setUser(user)
      toast(e instanceof ApiError ? e.message : 'Could not change that setting.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Privacy" className="border-b border-zinc-800 px-4 py-5">
      <h3 className="text-lg font-bold">Privacy</h3>
      <div className="mt-2 flex items-start gap-4">
        <div className="flex-1">
          <label htmlFor={id} className="font-semibold">Protect my account</label>
          <p id={`${id}-help`} className="text-sm text-zinc-500">
            Only people you approve can follow you and see your posts. People who already follow you stay. Your replies and mentions reach only your followers.
          </p>
        </div>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={user.protectedAccount}
          aria-describedby={`${id}-help`}
          disabled={busy}
          onClick={() => void toggle()}
          className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${user.protectedAccount ? 'bg-brand' : 'bg-zinc-700'}`}
        >
          <span aria-hidden="true" className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${user.protectedAccount ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      <div className="mt-5">
        <label htmlFor={dmId} className="font-semibold">Who can message me</label>
        <p id={`${dmId}-help`} className="text-sm text-zinc-500">
          People you have already written to can always answer. Existing conversations stay in your inbox.
        </p>
        <select
          id={dmId}
          aria-describedby={`${dmId}-help`}
          value={user.dmPolicy}
          disabled={dmBusy}
          onChange={(e) => void changeDmPolicy(e.target.value as DmPolicy)}
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-black px-3 py-2 disabled:opacity-60"
        >
          <option value="EVERYONE">Everyone</option>
          <option value="FOLLOWED">Only people I follow</option>
          <option value="NOBODY">No one</option>
        </select>
      </div>
    </section>
  )
}
