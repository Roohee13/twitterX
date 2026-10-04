import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import type { ReportStatus } from '../../lib/types'

export const ADMIN_REPORTS_KEY = ['admin', 'reports']

/** What an admin can do with a report. Every change re-reads the lists, because a report moves between the Open and Handled views. */
export function useReportActions() {
  const queryClient = useQueryClient()
  const toast = useToast()

  return useMemo(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ADMIN_REPORTS_KEY })
    const fail = (e: unknown, fallback: string) => {
      toast(e instanceof ApiError ? e.message : fallback, 'error')
      return false
    }
    return {
      /** `kind` is the API's word for the target: "users" or "posts". */
      async setStatus(kind: 'users' | 'posts', reportId: number, status: ReportStatus): Promise<boolean> {
        try {
          await api.patch(`/api/admin/reports/${kind}/${reportId}`, { status })
          refresh()
          return true
        } catch (e) {
          return fail(e, 'Could not update the report.')
        }
      },
      async removePost(postId: number, note = ''): Promise<boolean> {
        try {
          await api.post(`/api/admin/posts/${postId}/remove`, { note })
          toast('The post was removed and its open reports resolved.')
          refresh()
          return true
        } catch (e) {
          return fail(e, 'Could not remove the post.')
        }
      },
      /** Account actions: `suspend` and `remove` take a reason for the user; `unsuspend` does not. */
      async accountAction(action: 'suspend' | 'unsuspend' | 'remove', userId: number, note = ''): Promise<boolean> {
        try {
          await api.post(`/api/admin/users/${userId}/${action}`, action === 'unsuspend' ? undefined : { note })
          toast({ suspend: 'The account was suspended.', unsuspend: 'The suspension was lifted.', remove: 'The account was removed.' }[action])
          refresh()
          return true
        } catch (e) {
          return fail(e, 'Could not change the account.')
        }
      },
    }
  }, [queryClient, toast])
}
