import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { ConversationResponse, CursorPage, MessageResponse } from '../../lib/types'

export const MESSAGES_KEY = ['messages']
export const INBOX_KEY = ['messages', 'inbox']
export const UNREAD_MESSAGES_KEY = ['messages', 'unread-count']
export const conversationKey = (id: number) => ['messages', 'conversation', id]
export const threadKey = (id: number) => ['messages', 'thread', id]

type Thread = InfiniteData<CursorPage<MessageResponse>>
type Inbox = InfiniteData<CursorPage<ConversationResponse>>

function addToTotal(queryClient: QueryClient, delta: number) {
  queryClient.setQueryData<{ count: number }>(UNREAD_MESSAGES_KEY, (old) => (old ? { count: Math.max(0, old.count + delta) } : old))
}

/** Puts a message at the end of a thread that is loaded (pages are newest first, so that is the front of the first page). */
function appendToThread(queryClient: QueryClient, message: MessageResponse) {
  const key = threadKey(message.conversationId)
  const data = queryClient.getQueryData<Thread>(key)
  if (!data || data.pages.length === 0 || data.pages.some((page) => page.items.some((m) => m.id === message.id))) return
  const [first, ...rest] = data.pages
  queryClient.setQueryData<Thread>(key, { ...data, pages: [{ ...first, items: [message, ...first.items] }, ...rest] })
}

/**
 * A message arrived (pushed) or was just sent. The thread and the inbox show it at once and the unread numbers follow;
 * then everything is read again to settle on what the server says. Reads already on their way are cancelled first because
 * they may have been answered before this message existed and would put the old state back.
 * `open`: the conversation is on screen, so an incoming message counts as read straight away.
 */
export async function addMessage(queryClient: QueryClient, message: MessageResponse, options: { mine: boolean; open: boolean }) {
  await queryClient.cancelQueries({ queryKey: MESSAGES_KEY })
  appendToThread(queryClient, message)
  const unread = !options.mine && !options.open
  const inbox = queryClient.getQueryData<Inbox>(INBOX_KEY)
  const known = inbox?.pages.flatMap((page) => page.items).find((c) => c.id === message.conversationId)
  if (inbox && known && inbox.pages.length > 0) {
    const updated: ConversationResponse = {
      ...known,
      updatedAt: message.createdAt,
      lastMessage: { id: message.id, senderId: message.sender.id, content: message.content, createdAt: message.createdAt },
      unreadCount: unread ? known.unreadCount + 1 : known.unreadCount,
    }
    const [first, ...rest] = inbox.pages.map((page) => ({ ...page, items: page.items.filter((c) => c.id !== message.conversationId) }))
    queryClient.setQueryData<Inbox>(INBOX_KEY, { ...inbox, pages: [{ ...first, items: [updated, ...first.items] }, ...rest] })
  }
  if (unread) addToTotal(queryClient, 1)
  void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
}

/** Reads that were cancelled before they had any data (a first load) would stay empty for good, so they start again. */
function reviveEmpty(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY, predicate: (q) => q.state.data === undefined })
}

/** You opened or read the conversation: its unread count goes to zero, and the total drops by what it was. */
export async function markConversationReadLocally(queryClient: QueryClient, id: number) {
  await queryClient.cancelQueries({ queryKey: MESSAGES_KEY })
  let removed = 0
  const inbox = queryClient.getQueryData<Inbox>(INBOX_KEY)
  if (inbox) {
    queryClient.setQueryData<Inbox>(INBOX_KEY, {
      ...inbox,
      pages: inbox.pages.map((page) => ({
        ...page,
        items: page.items.map((c) => {
          if (c.id !== id) return c
          removed = c.unreadCount
          return { ...c, unreadCount: 0 }
        }),
      })),
    })
  }
  const single = queryClient.getQueryData<ConversationResponse>(conversationKey(id))
  if (single) {
    removed ||= single.unreadCount
    queryClient.setQueryData<ConversationResponse>(conversationKey(id), { ...single, unreadCount: 0 })
  }
  if (removed) addToTotal(queryClient, -removed)
  reviveEmpty(queryClient)
}
