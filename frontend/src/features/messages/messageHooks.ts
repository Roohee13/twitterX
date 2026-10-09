import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useMatch, useNavigate } from 'react-router'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import type { ConversationResponse, ConversationUpdate, MessageResponse } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { useLiveConnect, useLiveSubscription } from '../notifications/liveSocketContext'
import { MESSAGES_KEY, UNREAD_MESSAGES_KEY, addMessage, applyConversationUpdate, markConversationReadLocally, replaceMessage } from './messageCache'

/** The same limits as the server: a group has at most this many people (the owner included) and its name this many characters. */
export const MAX_GROUP_MEMBERS = 50
export const MAX_GROUP_TITLE = 100

export const membersKey = (conversationId: number) => ['messages', 'members', conversationId]

/** How many messages are waiting across all conversations; what the badge in the navigation shows. */
export function useUnreadMessages() {
  return useQuery({
    queryKey: UNREAD_MESSAGES_KEY,
    queryFn: () => api.get<{ count: number }>('/api/conversations/unread-count'),
    staleTime: 30_000,
    select: (data) => data.count,
  })
}

/** Tells the server that everything in the conversation has been seen, and shows it at once. */
export async function markRead(queryClient: ReturnType<typeof useQueryClient>, conversationId: number) {
  await markConversationReadLocally(queryClient, conversationId)
  try {
    await api.post(`/api/conversations/${conversationId}/read`)
  } catch {
    void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY }) // could not be saved: show what the server thinks
  }
}

/** Mount once in the signed-in layout: puts messages pushed by the server into the open chat, the inbox and the badge. */
export function useLiveMessages() {
  const queryClient = useQueryClient()
  const openChat = useMatch('/messages/:id')
  const openId = openChat ? Number(openChat.params.id) : null
  const onPush = useCallback(
    (body: unknown) => {
      const message = body as MessageResponse
      const open = openId === message.conversationId && document.visibilityState === 'visible'
      void addMessage(queryClient, message, { mine: false, open }).then(() => {
        if (open) void markRead(queryClient, message.conversationId)
      })
    },
    [queryClient, openId],
  )
  useLiveSubscription('/user/queue/messages', onPush)
  // The other person edited or deleted one of their messages: replace it, do not add another.
  const onUpdate = useCallback((body: unknown) => void replaceMessage(queryClient, body as MessageResponse), [queryClient])
  useLiveSubscription('/user/queue/message-updates', onUpdate)
  // A group you are in was renamed or had its members changed, or you are out of it: if it is the open chat, leave it when you are out.
  const navigate = useNavigate()
  const onConversationUpdate = useCallback(
    (body: unknown) => {
      const update = body as ConversationUpdate
      if (update.removed && openId === update.conversationId) navigate('/messages', { replace: true })
      void applyConversationUpdate(queryClient, update)
    },
    [queryClient, openId, navigate],
  )
  useLiveSubscription('/user/queue/conversation-updates', onConversationUpdate)
  // Messages that arrived before the connection was up (or while it was down) were never pushed, so read the real state.
  const catchUp = useCallback(() => void queryClient.invalidateQueries({ queryKey: MESSAGES_KEY }), [queryClient])
  useLiveConnect(catchUp)
}

/** Opens (creating if needed) the conversation with someone and goes to it. Failures, like a block, are shown as a message. */
export function useStartConversation() {
  const navigate = useNavigate()
  const toast = useToast()
  const me = useCurrentUser()
  return useCallback(
    async (username: string): Promise<boolean> => {
      if (username === me.username) return false
      try {
        const conversation = await api.post<ConversationResponse>('/api/conversations', { username })
        navigate(`/messages/${conversation.id}`)
        return true
      } catch (e) {
        toast(e instanceof ApiError ? e.message : 'Could not start the conversation.', 'error')
        return false
      }
    },
    [navigate, toast, me.username],
  )
}

/** Creates a group with these people (by username) and goes to it. Failures, like a block, are shown as a message. */
export function useCreateGroup() {
  const navigate = useNavigate()
  const toast = useToast()
  return useCallback(
    async (title: string, usernames: string[]): Promise<boolean> => {
      try {
        const group = await api.post<ConversationResponse>('/api/conversations/groups', { title, usernames })
        navigate(`/messages/${group.id}`)
        return true
      } catch (e) {
        toast(e instanceof ApiError ? e.message : 'Could not create the group.', 'error')
        return false
      }
    },
    [navigate, toast],
  )
}
