import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { ErrorState } from '../../components/ui/States'
import { ApiError, api } from '../../lib/api'
import { useCursorQuery } from '../../lib/queries'
import type { ConversationResponse, MessageResponse } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { PageHeader } from '../shell/PageHeader'
import { MessageBubble } from './MessageBubble'
import { MessageComposer } from './MessageComposer'
import { addMessage, conversationKey, threadKey } from './messageCache'
import { markRead } from './messageHooks'

interface Pending {
  key: number
  content: string
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

  const conversation = useQuery({
    queryKey: conversationKey(id),
    queryFn: () => api.get<ConversationResponse>(`/api/conversations/${id}`),
    retry: false,
  })
  const thread = useCursorQuery<MessageResponse>(threadKey(id), `/api/conversations/${id}/messages`, { enabled: conversation.isSuccess, limit: 30 })

  // Pages come newest first; the chat reads oldest first.
  const messages = useMemo(() => (thread.data?.pages.flatMap((page) => page.items) ?? []).slice().reverse(), [thread.data])
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

  function send(content: string) {
    const key = ++counter.current
    setPending((p) => [...p, { key, content }])
    // One at a time, so messages reach the server in the order they were written.
    queue.current = queue.current.then(async () => {
      try {
        const saved = await api.post<MessageResponse>(`/api/conversations/${id}/messages`, { content })
        await addMessage(queryClient, saved, { mine: true, open: true })
        setPending((p) => p.filter((x) => x.key !== key))
      } catch (e) {
        const error = e instanceof ApiError ? e.message : 'Could not send.'
        setPending((p) => p.map((x) => (x.key === key ? { ...x, error } : x)))
      }
    })
  }

  function retry(item: Pending) {
    setPending((p) => p.filter((x) => x.key !== item.key))
    send(item.content)
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
  return (
    <>
      <PageHeader title={participant.displayName}>
        <Link to="/messages" aria-label="Back to messages" className="order-first -ml-2 rounded-full p-2 hover:bg-zinc-900"><ArrowLeft size={20} /></Link>
        <Link to={`/u/${participant.username}`} aria-label={`${participant.displayName}'s profile`} className="order-first"><Avatar src={participant.avatarUrl} name={participant.displayName} size="sm" /></Link>
      </PageHeader>
      <div className="flex min-h-[calc(100vh-8rem)] flex-col justify-end gap-1 px-4 py-4">
        {thread.hasNextPage && (
          <Button variant="ghost" size="sm" className="mx-auto mb-2" loading={thread.isFetchingNextPage} onClick={() => void thread.fetchNextPage()}>Load older messages</Button>
        )}
        {thread.isPending && <Spinner />}
        {thread.isError && <ErrorState message={thread.error.message} onRetry={() => void thread.refetch()} />}
        {thread.data && messages.length === 0 && pending.length === 0 && <p className="py-8 text-center text-zinc-500">No messages yet. Say hello to {participant.displayName}.</p>}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {(i === 0 || day(messages[i - 1].createdAt) !== day(m.createdAt)) && <p className="my-2 text-center text-xs text-zinc-500">{dayLabel(m.createdAt)}</p>}
            <MessageBubble content={m.content} createdAt={m.createdAt} mine={m.sender.id === me.id} />
          </Fragment>
        ))}
        {pending.map((item) => (
          <div key={item.key}>
            <MessageBubble content={item.content} mine state={item.error ? 'failed' : 'sending'} />
            {item.error && (
              <div role="alert" className="mt-1 flex items-center justify-end gap-2 text-sm text-red-400">
                <span>{item.error}</span>
                <button type="button" className="font-semibold underline" onClick={() => retry(item)}>Retry</button>
                <button type="button" className="font-semibold underline" onClick={() => setPending((p) => p.filter((x) => x.key !== item.key))}>Discard</button>
              </div>
            )}
          </div>
        ))}
        {/* The margin keeps the newest message clear of the writing box (and, on phones, the bottom bar) that float over the page. */}
        <div ref={end} className="scroll-mb-40" />
      </div>
      <MessageComposer onSend={send} />
    </>
  )
}
