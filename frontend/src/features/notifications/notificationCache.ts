import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { CursorPage, NotificationResponse } from '../../lib/types'

export const NOTIFICATIONS_KEY = ['notifications']
export const UNREAD_COUNT_KEY = ['notifications', 'unread-count']

type Pages = InfiniteData<CursorPage<NotificationResponse>>

/** Only the list queries: the unread-count query shares the key prefix but holds a different shape. */
function lists(queryClient: QueryClient) {
  return queryClient.getQueriesData<Pages>({ queryKey: NOTIFICATIONS_KEY }).filter(([key]) => key[1] === 'list')
}

function mapItems(queryClient: QueryClient, change: (items: NotificationResponse[]) => NotificationResponse[]) {
  for (const [key, data] of lists(queryClient)) {
    if (!data) continue
    queryClient.setQueryData<Pages>(key, { ...data, pages: data.pages.map((page) => ({ ...page, items: change(page.items) })) })
  }
}

function addToCount(queryClient: QueryClient, delta: number) {
  queryClient.setQueryData<{ count: number }>(UNREAD_COUNT_KEY, (old) => (old ? { count: Math.max(0, old.count + delta) } : old))
}

/**
 * A notification pushed by the server: on top of the loaded list and one more unread, at once. Then the lists and the count are
 * read again to settle on what the server says. Requests already on their way must be cancelled first: they may have been answered
 * before this notification existed, and arriving late would wipe it out again.
 */
export async function addPushed(queryClient: QueryClient, notification: NotificationResponse) {
  await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY })
  for (const [key, data] of lists(queryClient)) {
    if (!data || data.pages.some((page) => page.items.some((n) => n.id === notification.id))) continue
    const [first, ...rest] = data.pages
    queryClient.setQueryData<Pages>(key, { ...data, pages: [{ ...first, items: [notification, ...first.items] }, ...rest] })
  }
  addToCount(queryClient, 1)
  void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
}

/**
 * The three changes below are made by the user and shown at once. A read of the same data already on its way (for instance the
 * catch-up after the socket connected) was answered before the change, and would put the old state back when it arrives, so it is
 * cancelled first.
 */
export async function markReadLocally(queryClient: QueryClient, id: number) {
  await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY })
  let wasUnread = false
  mapItems(queryClient, (items) => items.map((n) => {
    if (n.id !== id) return n
    wasUnread ||= !n.read
    return { ...n, read: true }
  }))
  if (wasUnread) addToCount(queryClient, -1)
}

export async function markAllReadLocally(queryClient: QueryClient) {
  await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY })
  mapItems(queryClient, (items) => items.map((n) => ({ ...n, read: true })))
  queryClient.setQueryData<{ count: number }>(UNREAD_COUNT_KEY, (old) => (old ? { count: 0 } : old))
}

export async function removeLocally(queryClient: QueryClient, id: number) {
  await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY })
  let wasUnread = false
  mapItems(queryClient, (items) => items.filter((n) => {
    if (n.id === id) wasUnread ||= !n.read
    return n.id !== id
  }))
  if (wasUnread) addToCount(queryClient, -1)
}
