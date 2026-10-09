import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { ConversationResponse, ConversationUpdate, CursorPage, MessageResponse } from '../../lib/types'

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

/**
 * Puts a message at the end of a thread that is loaded. The API's first page holds the latest messages and each page is ordered oldest to
 * newest (older pages follow), so the newest message goes at the end of the first page.
 */
function appendToThread(queryClient: QueryClient, message: MessageResponse) {
  const key = threadKey(message.conversationId)
  const data = queryClient.getQueryData<Thread>(key)
  if (!data || data.pages.length === 0 || data.pages.some((page) => page.items.some((m) => m.id === message.id))) return
  const [first, ...rest] = data.pages
  queryClient.setQueryData<Thread>(key, { ...data, pages: [{ ...first, items: [...first.items, message] }, ...rest] })
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
      lastMessage: { id: message.id, senderId: message.sender.id, content: message.content, createdAt: message.createdAt, deleted: message.deleted, hasMedia: (message.mediaUrls?.length ?? 0) > 0, senderName: message.sender.displayName },
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

/**
 * A message was edited or deleted, by you or (pushed) by the other person: every place that shows it changes at once, then the lists are read
 * again (a deleted message may have been one of the unread ones, and only the server knows). Reads already on their way are cancelled first,
 * as in addMessage.
 */
export async function replaceMessage(queryClient: QueryClient, message: MessageResponse) {
  await queryClient.cancelQueries({ queryKey: MESSAGES_KEY })
  const key = threadKey(message.conversationId)
  const thread = queryClient.getQueryData<Thread>(key)
  if (thread) {
    queryClient.setQueryData<Thread>(key, {
      ...thread,
      pages: thread.pages.map((page) => ({ ...page, items: page.items.map((m) => (m.id === message.id ? message : m)) })),
    })
  }
  const inbox = queryClient.getQueryData<Inbox>(INBOX_KEY)
  if (inbox) {
    queryClient.setQueryData<Inbox>(INBOX_KEY, {
      ...inbox,
      pages: inbox.pages.map((page) => ({
        ...page,
        items: page.items.map((c) =>
          c.lastMessage?.id === message.id ? { ...c, lastMessage: { ...c.lastMessage, content: message.content, deleted: message.deleted, hasMedia: (message.mediaUrls?.length ?? 0) > 0 } } : c,
        ),
      })),
    })
  }
  void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
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

/**
 * You deleted a conversation (for yourself): it leaves the inbox, its history and detail are forgotten, and what it held as unread leaves the
 * total. Then the lists are read again, so the server has the last word (a message that arrived meanwhile brings it back).
 */
export async function removeConversationLocally(queryClient: QueryClient, id: number) {
  await queryClient.cancelQueries({ queryKey: MESSAGES_KEY })
  let unread = 0
  const inbox = queryClient.getQueryData<Inbox>(INBOX_KEY)
  if (inbox) {
    queryClient.setQueryData<Inbox>(INBOX_KEY, {
      ...inbox,
      pages: inbox.pages.map((page) => ({
        ...page,
        items: page.items.filter((c) => {
          if (c.id === id) unread = c.unreadCount
          return c.id !== id
        }),
      })),
    })
  }
  unread ||= queryClient.getQueryData<ConversationResponse>(conversationKey(id))?.unreadCount ?? 0
  queryClient.removeQueries({ queryKey: threadKey(id) })
  queryClient.removeQueries({ queryKey: conversationKey(id) })
  if (unread) addToTotal(queryClient, -unread)
  void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
}

/**
 * A group you are in was created, renamed or had its members changed (pushed): the open chat and the inbox row show the new name and
 * member count at once, then the lists are read again. When you are out of the group (you left, or were removed) it is forgotten like a
 * deleted conversation.
 */
export async function applyConversationUpdate(queryClient: QueryClient, update: ConversationUpdate) {
  const { conversation } = update
  if (update.removed || !conversation) {
    await removeConversationLocally(queryClient, update.conversationId)
    return
  }
  await queryClient.cancelQueries({ queryKey: MESSAGES_KEY })
  queryClient.setQueryData<ConversationResponse>(conversationKey(conversation.id), conversation)
  const inbox = queryClient.getQueryData<Inbox>(INBOX_KEY)
  if (inbox) {
    queryClient.setQueryData<Inbox>(INBOX_KEY, {
      ...inbox,
      pages: inbox.pages.map((page) => ({ ...page, items: page.items.map((c) => (c.id === conversation.id ? conversation : c)) })),
    })
  }
  void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY })
}
