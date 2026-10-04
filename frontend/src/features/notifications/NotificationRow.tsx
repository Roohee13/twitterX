import { X } from 'lucide-react'
import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { fullDate, timeAgo } from '../../lib/time'
import type { NotificationResponse } from '../../lib/types'
import { notificationIcon, notificationSentence, notificationTarget } from './notificationText'

interface NotificationRowProps {
  notification: NotificationResponse
  onOpen: (n: NotificationResponse) => void
  onDelete: (n: NotificationResponse) => void
}

export function NotificationRow({ notification: n, onOpen, onDelete }: NotificationRowProps) {
  const { icon: Icon, color } = notificationIcon[n.type]
  const target = notificationTarget(n)
  const body = (
    <>
      <Icon size={24} className={`mt-1 shrink-0 ${color}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {n.actor && <Avatar src={n.actor.avatarUrl} name={n.actor.displayName} size="sm" />}
        <p className="mt-1 break-words">
          {n.actor && <span className="font-bold">{n.actor.displayName} </span>}
          {notificationSentence(n)}
        </p>
        {n.postContent && n.type !== 'POST_REMOVED' && <p className="mt-1 line-clamp-3 break-words text-zinc-500">{n.postContent}</p>}
        <time dateTime={n.createdAt} title={fullDate(n.createdAt)} className="mt-1 block text-sm text-zinc-500">{timeAgo(n.createdAt)}</time>
      </div>
    </>
  )
  const className = 'flex min-w-0 flex-1 gap-3 py-3 pl-4 text-left'
  return (
    <article
      aria-label={`${n.read ? '' : 'Unread: '}${n.actor ? n.actor.displayName + ' ' : ''}${notificationSentence(n)}`}
      className={`flex items-start border-b border-zinc-800 ${n.read ? '' : 'bg-brand/10'}`}
    >
      {target ? (
        <Link to={target} onClick={() => onOpen(n)} className={`${className} hover:bg-white/[0.03]`}>{body}</Link>
      ) : (
        <button type="button" onClick={() => onOpen(n)} className={`${className} hover:bg-white/[0.03]`}>{body}</button>
      )}
      <button type="button" aria-label="Delete notification" onClick={() => onDelete(n)} className="m-2 rounded-full p-2 text-zinc-500 hover:bg-zinc-800 hover:text-white">
        <X size={18} />
      </button>
    </article>
  )
}
