import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import type { ProfileResponse } from '../../lib/types'
import type { ReportReason } from '../common/ReportDialog'
import { invalidateFeeds } from '../../lib/feedCache'

/** Everything about one account shares this key prefix, so `invalidateQueries({ queryKey: profileKey(name) })` refreshes the page and all its tabs. */
export const profileKey = (username: string) => ['profile', username.toLowerCase()] as const

export function useProfile(username: string) {
  return useQuery({
    queryKey: profileKey(username),
    queryFn: ({ signal }) => api.get<ProfileResponse>(`/api/users/${encodeURIComponent(username)}`, { signal }),
    retry: (failures, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
  })
}

const messageOf = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

/**
 * Follow, mute, block and report an account. Follow, mute and block change the profile on screen at once and are then
 * re-read from the server, which has the final say (a protected account turns "follow" into a request, a block removes follows).
 */
export function useProfileActions(profile: ProfileResponse) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const username = profile.username
  const path = `/api/users/${encodeURIComponent(username)}`

  const patch = useCallback(
    (change: (p: ProfileResponse) => ProfileResponse) => queryClient.setQueryData<ProfileResponse>(profileKey(username), (old) => (old ? change(old) : old)),
    [queryClient, username],
  )
  const settle = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: profileKey(username) })
    invalidateFeeds(queryClient) // whose posts appear there changed
  }, [queryClient, username])

  return useMemo(() => {
    async function run(optimistic: (p: ProfileResponse) => ProfileResponse, request: () => Promise<unknown>, failure: string): Promise<boolean> {
      const before = queryClient.getQueryData<ProfileResponse>(profileKey(username))
      patch(optimistic)
      try {
        await request()
        settle()
        return true
      } catch (e) {
        if (before) queryClient.setQueryData(profileKey(username), before)
        toast(messageOf(e, failure), 'error')
        return false
      }
    }
    return {
      follow: () =>
        run(
          (p) => (p.protectedAccount ? { ...p, followRequestedByMe: true } : { ...p, followedByMe: true, followerCount: p.followerCount + 1 }),
          () => api.post(`${path}/follow`),
          'Could not follow this account.',
        ),
      unfollow: () =>
        run(
          (p) => ({ ...p, followedByMe: false, followRequestedByMe: false, followerCount: Math.max(0, p.followerCount - (p.followedByMe ? 1 : 0)) }),
          () => api.delete(`${path}/follow`),
          'Could not unfollow this account.',
        ),
      mute: () => run((p) => ({ ...p, mutedByMe: true }), () => api.post(`${path}/mute`), 'Could not mute this account.'),
      unmute: () => run((p) => ({ ...p, mutedByMe: false }), () => api.delete(`${path}/mute`), 'Could not unmute this account.'),
      block: () =>
        run(
          (p) => ({ ...p, blockedByMe: true, followedByMe: false, followRequestedByMe: false }),
          () => api.post(`${path}/block`),
          'Could not block this account.',
        ),
      unblock: () => run((p) => ({ ...p, blockedByMe: false }), () => api.delete(`${path}/block`), 'Could not unblock this account.'),
      async report(reason: ReportReason): Promise<boolean> {
        try {
          await api.post(`${path}/report`, { reason })
          toast("Thanks for letting us know. We'll take a look.")
          return true
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            toast('You already reported this account.')
            return true
          }
          toast(messageOf(e, 'Could not send your report.'), 'error')
          return false
        }
      },
    }
  }, [patch, path, queryClient, settle, toast, username])
}
