import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { timeAgo } from '../../lib/time'
import type { ConversationResponse } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { GroupAvatar } from './GroupAvatar'

/** One line of the inbox: who, the newest message, when, and how many are unread. */
export function ConversationRow({ conversation }: { conversation: ConversationResponse }) {
  const me = useCurrentUser()
  const { participant, lastMessage, unreadCount } = conversation
  const group = conversation.type === 'GROUP' || participant === null
  const name = group ? (conversation.title ?? 'Group') : participant.displayName
  const mine = lastMessage?.senderId === me.id
  const sender = mine ? 'You: ' : group && lastMessage?.senderName ? `${lastMessage.senderName}: ` : ''
  const preview = !lastMessage
    ? 'No messages yet'
    : lastMessage.deleted
      ? mine ? 'You deleted a message' : 'This message was deleted'
      : `${sender}${lastMessage.content || (lastMessage.hasMedia ? 'Sent a photo' : '')}`
  return (
    <Link
      to={`/messages/${conversation.id}`}
      aria-label={`${group ? 'Group' : 'Conversation with'} ${name}${unreadCount ? `, ${unreadCount} unread` : ''}`}
      className={`flex items-center gap-3 border-b border-zinc-800 px-4 py-3 hover:bg-hover ${unreadCount ? 'bg-brand/10' : ''}`}
    >
      {group ? <GroupAvatar /> : <Avatar src={participant.unavailable ? null : participant.avatarUrl} name={participant.displayName} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-bold">{name}</span>
          {group ? (
            conversation.memberCount ? <span className="shrink-0 text-zinc-500">{conversation.memberCount} members</span> : null
          ) : (
            !participant.unavailable && <span className="truncate text-zinc-500">@{participant.username}</span>
          )}
          {lastMessage && <time dateTime={lastMessage.createdAt} className="ml-auto shrink-0 text-sm text-zinc-500">{timeAgo(lastMessage.createdAt)}</time>}
        </div>
        <p className={`truncate ${unreadCount ? 'font-semibold text-zinc-100' : 'text-zinc-500'}`}>{preview}</p>
      </div>
      {unreadCount > 0 && <span aria-hidden="true" className="min-w-[22px] rounded-full bg-brand-solid px-1.5 text-center text-sm font-bold leading-[22px] text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </Link>
  )
}
