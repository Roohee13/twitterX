import { useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui/Button'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import { useCursorQuery } from '../../lib/queries'
import type { NotificationResponse } from '../../lib/types'
import { PageHeader } from '../shell/PageHeader'
import { NotificationRow } from './NotificationRow'
import { NOTIFICATIONS_KEY, markAllReadLocally, markReadLocally, removeLocally } from './notificationCache'
import { useUnreadCount } from './notificationHooks'

export function NotificationsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const unread = useUnreadCount()
  const notifications = useCursorQuery<NotificationResponse>([...NOTIFICATIONS_KEY, 'list'], '/api/notifications', { staleTime: 5_000 })

  const fail = (e: unknown, fallback: string) => toast(e instanceof ApiError ? e.message : fallback, 'error')

  async function open(n: NotificationResponse) {
    if (n.read) return
    await markReadLocally(queryClient, n.id)
    try {
      await api.post(`/api/notifications/${n.id}/read`)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) fail(e, 'Could not mark it as read.')
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
    }
  }

  async function markAllRead() {
    await markAllReadLocally(queryClient)
    try {
      await api.post('/api/notifications/read')
    } catch (e) {
      fail(e, 'Could not mark everything as read.')
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
    }
  }

  async function remove(n: NotificationResponse) {
    await removeLocally(queryClient, n.id)
    try {
      await api.delete(`/api/notifications/${n.id}`)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) fail(e, 'Could not delete the notification.')
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
    }
  }

  return (
    <>
      <PageHeader title="Notifications">
        <Button size="sm" variant="secondary" className="ml-auto" disabled={!unread.data} onClick={() => void markAllRead()}>
          Mark all read
        </Button>
      </PageHeader>
      <InfiniteList
        query={notifications}
        getKey={(n) => n.id}
        renderItem={(n) => <NotificationRow notification={n} onOpen={(x) => void open(x)} onDelete={(x) => void remove(x)} />}
        emptyTitle="Nothing here yet"
        emptyText="Likes, replies, mentions and new followers will show up here."
      />
    </>
  )
}
