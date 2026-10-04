import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import { useCursorQuery } from '../../lib/queries'
import type { UserSummary } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { PageHeader } from '../shell/PageHeader'
import { profileKey } from './profileData'

export const FOLLOW_REQUESTS_KEY = ['follow-requests']

function RequestRow({ user }: { user: UserSummary }) {
  const queryClient = useQueryClient()
  const me = useCurrentUser()
  const toast = useToast()
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)

  async function answer(action: 'approve' | 'deny') {
    setBusy(action)
    try {
      await api.post(`/api/users/me/follow-requests/${encodeURIComponent(user.username)}/${action}`)
      toast(action === 'approve' ? `@${user.username} now follows you.` : `Request from @${user.username} denied.`)
    } catch (e) {
      // 404: it was already answered (or withdrawn) elsewhere, so the list is simply out of date.
      if (!(e instanceof ApiError && e.status === 404)) toast(e instanceof ApiError ? e.message : 'Could not answer the request.', 'error')
    } finally {
      setBusy(null)
      void queryClient.invalidateQueries({ queryKey: FOLLOW_REQUESTS_KEY })
      void queryClient.invalidateQueries({ queryKey: profileKey(me.username) })
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
      <Avatar src={user.avatarUrl} name={user.displayName} />
      <Link to={`/u/${user.username}`} className="min-w-0 flex-1">
        <span className="block truncate font-bold hover:underline">{user.displayName}</span>
        <span className="block truncate text-zinc-500">@{user.username}</span>
      </Link>
      <Button size="sm" aria-label={`Approve ${user.displayName}`} loading={busy === 'approve'} disabled={busy !== null} onClick={() => void answer('approve')}>Approve</Button>
      <Button size="sm" variant="secondary" aria-label={`Deny ${user.displayName}`} loading={busy === 'deny'} disabled={busy !== null} onClick={() => void answer('deny')}>Deny</Button>
    </div>
  )
}

/** People waiting for you to approve them as followers of your protected account. */
export function FollowRequestsPage() {
  const requests = useCursorQuery<UserSummary>(FOLLOW_REQUESTS_KEY, '/api/users/me/follow-requests', { staleTime: 5_000 })
  return (
    <>
      <PageHeader title="Follow requests" />
      <InfiniteList
        query={requests}
        getKey={(user) => user.id}
        renderItem={(user) => <RequestRow user={user} />}
        emptyTitle="No pending requests"
        emptyText="When someone asks to follow your protected account, they will show up here."
      />
    </>
  )
}
