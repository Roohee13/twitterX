import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import type { SuggestionResponse, UserSummary } from '../../lib/types'

/** Follow button for a person in a list. The list does not say whether you already follow them, so it only offers "Follow"
 * and then shows what happened (Following, or Requested for a protected account). */
export function FollowChip({ user }: { user: UserSummary }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [state, setState] = useState<'idle' | 'busy' | 'following' | 'requested'>('idle')

  async function follow() {
    setState('busy')
    try {
      await api.post(`/api/users/${encodeURIComponent(user.username)}/follow`)
      setState(user.protectedAccount ? 'requested' : 'following')
      void queryClient.invalidateQueries({ queryKey: ['timeline'] })
      void queryClient.invalidateQueries({ queryKey: ['profile', user.username.toLowerCase()] })
    } catch (e) {
      setState('idle')
      toast(e instanceof ApiError ? e.message : 'Could not follow this account.', 'error')
    }
  }

  if (state === 'following' || state === 'requested') {
    return <span className="rounded-full border border-zinc-600 px-4 py-1 text-sm font-semibold text-zinc-300">{state === 'following' ? 'Following' : 'Requested'}</span>
  }
  return (
    <Button size="sm" aria-label={`Follow @${user.username}`} loading={state === 'busy'} onClick={() => void follow()} className="!bg-zinc-100 !text-zinc-900 hover:!bg-zinc-200">
      Follow
    </Button>
  )
}

function mutualText(count: number) {
  return count > 0 ? `Followed by ${count} ${count === 1 ? 'person' : 'people'} you follow` : null
}

/** People you might want to follow: friends of friends first, popular accounts for new users. Renders nothing when there are none. */
export function WhoToFollow({ limit, heading = 'Who to follow', children }: { limit: number; heading?: string; children?: React.ReactNode }) {
  const suggestions = useQuery({
    queryKey: ['suggestions', limit],
    queryFn: ({ signal }) => api.get<SuggestionResponse[]>(`/api/users/suggestions?limit=${limit}`, { signal }),
    staleTime: 60_000,
  })
  if (!suggestions.data || suggestions.data.length === 0) return null

  return (
    <section aria-label={heading} className="rounded-2xl bg-zinc-900 py-3">
      <h2 className="px-4 pb-2 text-xl font-extrabold">{heading}</h2>
      {suggestions.data.map(({ user, mutualFollowCount }) => (
        <div key={user.id} className="flex items-center gap-3 px-4 py-2 hover:bg-zinc-800">
          <Link to={`/u/${user.username}`} tabIndex={-1} aria-hidden="true"><Avatar src={user.avatarUrl} name={user.displayName} /></Link>
          <Link to={`/u/${user.username}`} className="min-w-0 flex-1">
            <span className="flex items-center gap-1 font-bold hover:underline">
              <span className="truncate">{user.displayName}</span>
              {user.protectedAccount && <Lock size={13} aria-label="Protected account" className="shrink-0 text-zinc-400" />}
            </span>
            <span className="block truncate text-sm text-zinc-500">@{user.username}</span>
            {mutualText(mutualFollowCount) && <span className="block text-xs text-zinc-500">{mutualText(mutualFollowCount)}</span>}
          </Link>
          <FollowChip user={user} />
        </div>
      ))}
      {children}
    </section>
  )
}
