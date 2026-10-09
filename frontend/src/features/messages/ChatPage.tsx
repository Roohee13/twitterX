import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, MoreHorizontal } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DropdownMenu } from '../../components/ui/DropdownMenu'
import { useToast } from '../../components/ui/Toast'
import { Spinner } from '../../components/ui/Spinner'
import { ErrorState } from '../../components/ui/States'
import { ApiError, api } from '../../lib/api'
import { useCursorQuery } from '../../lib/queries'
import type { ConversationResponse, MessageResponse } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { PageHeader } from '../shell/PageHeader'
import { GroupAvatar } from './GroupAvatar'
import { GroupInfoDialog } from './GroupInfoDialog'
import { MessageBubble } from './MessageBubble'
import { MessageItem } from './MessageItem'
import { MessageComposer, type Outgoing } from './MessageComposer'
import { addMessage, conversationKey, removeConversationLocally, threadKey } from './messageCache'
import { markRead } from './messageHooks'

interface Pending extends Outgoing {
  key: number
  error?: string
}

const day = (iso: string) => new Date(iso).toDateString()
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })

/** One conversation: the messages oldest to newest, a box to write in, and new messages arriving live. */
export function ChatPage() {
  const id = Number(useParams().id)
  const me = useCurrentUser()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<Pending[]>([])
  const counter = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const end = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [showingInfo, setShowingInfo] = useState(false)

  const conversation = useQuery({
    queryKey: conversationKey(id),
    queryFn: () => api.get<ConversationResponse>(`/api/conversations/${id}`),
    retry: false,
  })
  const thread = useCursorQuery<MessageResponse>(threadKey(id), `/api/conversations/${id}/messages`, { enabled: conversation.isSuccess, limit: 30 })

  // The first page holds the latest messages and the following pages go further back in time, each one ordered oldest to newest.
  // Reading top to bottom therefore means the last page first.
  const messages = useMemo(() => (thread.data?.pages ?? []).slice().reverse().flatMap((page) => page.items), [thread.data])
  const newestId = messages.at(-1)?.id

  // Opening a conversation with unread messages reads them.
  const unread = conversation.data?.unreadCount ?? 0
  useEffect(() => {
    if (unread > 0) void markRead(queryClient, id)
  }, [unread, id, queryClient])

  // New content at the bottom (a message arrived or was sent) scrolls into view; loading older messages above does not.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [newestId, pending.length])

  /** The local previews of a message the server now has (or the person gave up on) are no longer needed. */
  const forget = (item: Pending) => item.previews.forEach((url) => URL.revokeObjectURL(url))

  function send(message: Outgoing, key = ++counter.current) {
    const { content, mediaKeys } = message
    setPending((p) => [...p.filter((x) => x.key !== key), { key, ...message }])
    // One at a time, so messages reach the server in the order they were written.
    queue.current = queue.current.then(async () => {
      try {
        const saved = await api.post<MessageResponse>(`/api/conversations/${id}/messages`, { content, ...(mediaKeys.length > 0 ? { mediaKeys } : {}) })
        await addMessage(queryClient, saved, { mine: true, open: true })
        setPending((p) => p.filter((x) => x.key !== key))
        forget({ key, ...message })
      } catch (e) {
        const error = e instanceof ApiError ? e.message : 'Could not send.'
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error } : x)))
      }
    })
  }

  /** Deletes the conversation for you only (the other person keeps theirs) and goes back to the inbox. */
  async function deleteConversation(): Promise<boolean> {
    try {
      await api.delete(`/api/conversations/${id}`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not delete the conversation.', 'error')
      return false
    }
    navigate('/messages', { replace: true })
    toast('Conversation deleted.')
    void removeConversationLocally(queryClient, id)
    return true
  }

  function retry(item: Pending) {
    send({ content: item.content, mediaKeys: item.mediaKeys, previews: item.previews }, item.key)
  }

  function discard(item: Pending) {
    setPending((p) => p.filter((x) => x.key !== item.key))
    forget(item)
  }

  if (conversation.isPending) return <Spinner />
  if (conversation.isError) {
    return (
      <>
        <PageHeader title="Messages">
          <Link to="/messages" aria-label="Back to messages" className="order-first -ml-2 rounded-full p-2 hover:bg-zinc-900"><ArrowLeft size={20} /></Link>
        </PageHeader>
        <ErrorState message={conversation.error instanceof ApiError ? conversation.error.message : 'Could not open the conversation.'} />
      </>
    )
  }

  const { participant } = conversation.data
  const group = conversation.data.type === 'GROUP' || participant === null
  const name = group ? (conversation.data.title ?? 'Group') : participant.displayName
  const unavailable = !group && participant.unavailable === true
  return (
    <>
      <PageHeader title={name}>
        <div className="ml-auto">
          <DropdownMenu
            label="Conversation actions"
            triggerClassName="rounded-full p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            trigger={<MoreHorizontal size={20} />}
            items={[
              ...(group ? [{ label: 'Group info', onSelect: () => setShowingInfo(true) }] : []),
              { label: 'Delete conversation', onSelect: () => setConfirmingDelete(true), danger: true },
            ]}
          />
        </div>
        <Link to="/messages" aria-label="Back to messages" className="order-first -ml-2 rounded-full p-2 hover:bg-zinc-900"><ArrowLeft size={20} /></Link>
        {group ? (
          <button type="button" aria-label={`${name} group info`} onClick={() => setShowingInfo(true)} className="order-first rounded-full"><GroupAvatar size="sm" /></button>
        ) : unavailable ? (
          <span className="order-first"><Avatar src={null} name={participant.displayName} size="sm" /></span>
        ) : (
          <Link to={`/u/${participant.username}`} aria-label={`${participant.displayName}'s profile`} className="order-first"><Avatar src={participant.avatarUrl} name={participant.displayName} size="sm" /></Link>
        )}
      </PageHeader>
      {showingInfo && <GroupInfoDialog conversation={conversation.data} onClose={() => setShowingInfo(false)} />}
      {confirmingDelete && (
        <ConfirmDialog title="Delete this conversation?" confirmLabel="Delete" danger onConfirm={deleteConversation} onClose={() => setConfirmingDelete(false)}>
          {group
            ? 'Its history is erased from your side and it disappears from your messages. The others keep theirs and are not told, and you stay in the group: if someone writes again, the conversation comes back with only the new messages. To stop receiving its messages, leave the group instead.'
            : `It disappears from your messages. ${participant.displayName} keeps their copy and is not told. If they write to you again, the conversation comes back with only the new messages.`}
        </ConfirmDialog>
      )}
      <div className="flex min-h-[calc(100vh-8rem)] flex-col justify-end gap-1 px-4 py-4">
        {thread.hasNextPage && (
          <Button variant="ghost" size="sm" className="mx-auto mb-2" loading={thread.isFetchingNextPage} onClick={() => void thread.fetchNextPage()}>Load older messages</Button>
        )}
        {thread.isPending && <Spinner />}
        {thread.isError && <ErrorState message={thread.error.message} onRetry={() => void thread.refetch()} />}
        {thread.data && messages.length === 0 && pending.length === 0 && <p className="py-8 text-center text-zinc-500">No messages yet. Say hello to {group ? 'the group' : participant.displayName}.</p>}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {(i === 0 || day(messages[i - 1].createdAt) !== day(m.createdAt)) && <p className="my-2 text-center text-xs text-zinc-500">{dayLabel(m.createdAt)}</p>}
            <MessageItem message={m} mine={m.sender.id === me.id} readOnly={unavailable} showSender={group} />
          </Fragment>
        ))}
        {pending.map((item) => (
          <div key={item.key}>
            <MessageBubble content={item.content} mediaUrls={item.previews} mine state={item.error ? 'failed' : 'sending'} />
            {item.error && (
              <div role="alert" className="mt-1 flex items-center justify-end gap-2 text-sm text-red-400">
                <span>{item.error}</span>
                <button type="button" className="font-semibold underline" onClick={() => retry(item)}>Retry</button>
                <button type="button" className="font-semibold underline" onClick={() => discard(item)}>Discard</button>
              </div>
            )}
          </div>
        ))}
        {/* The margin keeps the newest message clear of the writing box (and, on phones, the bottom bar) that float over the page. */}
        <div ref={end} className="scroll-mb-40" />
      </div>
      {unavailable ? (
        <p role="status" className="sticky bottom-16 z-10 border-t border-zinc-800 bg-black px-4 py-4 text-center text-zinc-500 sm:bottom-0">
          You can't reply to this conversation: this account is unavailable.
        </p>
      ) : (
        <MessageComposer onSend={send} />
      )}
    </>
  )
}
