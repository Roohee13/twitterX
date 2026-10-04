import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { api } from '../../lib/api'
import type { NotificationResponse } from '../../lib/types'
import { FOLLOW_REQUESTS_KEY } from '../profile/FollowRequestsPage'
import { useLiveConnect, useLiveSubscription } from './liveSocketContext'
import { NOTIFICATIONS_KEY, UNREAD_COUNT_KEY, addPushed } from './notificationCache'

/** How many notifications are waiting; also what the badge in the navigation shows. */
export function useUnreadCount() {
  return useQuery({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: () => api.get<{ count: number }>('/api/notifications/unread-count'),
    staleTime: 30_000,
    select: (data) => data.count,
  })
}

/** Mount once in the signed-in layout: puts notifications pushed by the server into the lists and the badge. */
export function useLiveNotifications() {
  const queryClient = useQueryClient()
  const onPush = useCallback(
    (body: unknown) => {
      const notification = body as NotificationResponse
      void addPushed(queryClient, notification)
      if (notification.type === 'FOLLOW_REQUEST') void queryClient.invalidateQueries({ queryKey: FOLLOW_REQUESTS_KEY })
    },
    [queryClient],
  )
  useLiveSubscription('/user/queue/notifications', onPush)
  // Whatever arrived before the connection was up (or while it was down) was never pushed to us, so read the real state.
  const catchUp = useCallback(() => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }), [queryClient])
  useLiveConnect(catchUp)
}
