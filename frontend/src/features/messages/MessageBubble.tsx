import { fullDate } from '../../lib/time'

interface MessageBubbleProps {
  content: string
  createdAt?: string
  mine: boolean
  /** Waiting for the server, or it did not go through. */
  state?: 'sending' | 'failed'
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function MessageBubble({ content, createdAt, mine, state }: MessageBubbleProps) {
  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <p className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 ${mine ? 'rounded-br-sm bg-brand-solid text-white' : 'rounded-bl-sm bg-zinc-800'} ${state === 'sending' ? 'opacity-60' : ''}`}>
        {content}
      </p>
      {createdAt && !state && <time dateTime={createdAt} title={fullDate(createdAt)} className="mt-0.5 px-1 text-xs text-zinc-500">{clock(createdAt)}</time>}
      {state === 'sending' && <span className="mt-0.5 px-1 text-xs text-zinc-500">Sending…</span>}
    </div>
  )
}
