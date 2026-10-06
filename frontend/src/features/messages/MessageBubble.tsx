import type { ReactNode } from 'react'
import { fullDate } from '../../lib/time'
import { MessagePhotos } from './MessagePhotos'

interface MessageBubbleProps {
  content: string
  /** Photos shown above the text (a photo-only message has no text). */
  mediaUrls?: string[]
  createdAt?: string
  mine: boolean
  /** Waiting for the server, or it did not go through. */
  state?: 'sending' | 'failed'
  /** The sender changed the text after sending it. */
  edited?: boolean
  /** The sender deleted it: only a placeholder is shown. */
  deleted?: boolean
  /** Buttons that appear beside the bubble (the sender's edit / delete menu). */
  actions?: ReactNode
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function MessageBubble({ content, mediaUrls = [], createdAt, mine, state, edited = false, deleted = false, actions }: MessageBubbleProps) {
  const shape = mine ? 'rounded-br-sm' : 'rounded-bl-sm'
  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div className={`group flex max-w-[85%] items-center gap-1 ${mine ? 'flex-row-reverse' : ''}`}>
        {deleted ? (
          <p className={`rounded-2xl border border-zinc-700 px-4 py-2 italic text-zinc-500 ${shape}`}>
            {mine ? 'You deleted this message' : 'This message was deleted'}
          </p>
        ) : (
          <div className={`min-w-0 overflow-hidden rounded-2xl ${mine ? `${shape} bg-brand-solid text-white` : `${shape} bg-zinc-800`} ${state === 'sending' ? 'opacity-60' : ''}`}>
            <MessagePhotos urls={mediaUrls} />
            {content && <p className="whitespace-pre-wrap break-words px-4 py-2">{content}</p>}
          </div>
        )}
        {actions && (
          // Out of the way until the pointer or the keyboard is on the message (always there on touch screens, which cannot hover).
          <div className="opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">{actions}</div>
        )}
      </div>
      {createdAt && !state && (
        <time dateTime={createdAt} title={fullDate(createdAt)} className="mt-0.5 px-1 text-xs text-zinc-500">
          {clock(createdAt)}
          {edited && !deleted && <span> · edited</span>}
        </time>
      )}
      {state === 'sending' && <span className="mt-0.5 px-1 text-xs text-zinc-500">Sending…</span>}
    </div>
  )
}
