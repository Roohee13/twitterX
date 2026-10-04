import { AtSign, Heart, MessageCircle, Repeat2, ShieldAlert, Trash2, UserCheck, UserPlus, type LucideIcon } from 'lucide-react'
import type { NotificationResponse, NotificationType } from '../../lib/types'

export const notificationIcon: Record<NotificationType, { icon: LucideIcon; color: string }> = {
  FOLLOW: { icon: UserPlus, color: 'text-brand' },
  FOLLOW_REQUEST: { icon: UserCheck, color: 'text-brand' },
  LIKE: { icon: Heart, color: 'text-pink-500' },
  REPOST: { icon: Repeat2, color: 'text-green-500' },
  REPLY: { icon: MessageCircle, color: 'text-brand' },
  MENTION: { icon: AtSign, color: 'text-brand' },
  REPORT_RECEIVED: { icon: ShieldAlert, color: 'text-amber-400' },
  POST_REMOVED: { icon: Trash2, color: 'text-red-400' },
  REPORT_OUTCOME: { icon: ShieldAlert, color: 'text-zinc-300' },
}

const sentence: Partial<Record<NotificationType, string>> = {
  FOLLOW: 'followed you',
  FOLLOW_REQUEST: 'asked to follow you',
  LIKE: 'liked your post',
  REPOST: 'reposted your post',
  REPLY: 'replied to your post',
  MENTION: 'mentioned you in a post',
}

/** What the notification says, without the actor's name (that is shown as a link next to it). Moderation messages carry their own text. */
export function notificationSentence(n: NotificationResponse): string {
  return sentence[n.type] ?? n.detail ?? ''
}

/** Where clicking the notification goes. */
export function notificationTarget(n: NotificationResponse): string | null {
  switch (n.type) {
    case 'FOLLOW':
      return n.actor ? `/u/${n.actor.username}` : null
    case 'FOLLOW_REQUEST':
      return '/follow-requests'
    case 'LIKE':
    case 'REPOST':
    case 'REPLY':
    case 'MENTION':
      return n.postId ? `/post/${n.postId}` : null
    case 'REPORT_RECEIVED':
      return '/admin/reports'
    default:
      return null // removal notices and report outcomes have nowhere to go
  }
}
