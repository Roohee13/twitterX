import { Bookmark, Heart, Link2, MessageCircle, Repeat2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { DropdownMenu, type MenuItem } from '../../components/ui/DropdownMenu'
import type { PostResponse } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { useCompose } from '../compose/ComposeContext'
import { usePostActions } from './usePostActions'

const base = 'group flex min-w-14 items-center gap-1.5 rounded-full p-2 text-sm text-zinc-500 transition-colors disabled:cursor-not-allowed disabled:opacity-40'

function Count({ value }: { value: number }) {
  return value > 0 ? <span aria-hidden="true">{value}</span> : null
}

function Action({ label, active, activeClass, hoverClass, count, onClick, disabled, title, children }: {
  label: string; active?: boolean; activeClass: string; hoverClass: string; count?: number; onClick: () => void; disabled?: boolean; title?: string; children: ReactNode
}) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} title={title ?? label} disabled={disabled} onClick={onClick} className={`${base} ${active ? activeClass : hoverClass}`}>
      {children}
      {count !== undefined && <Count value={count} />}
    </button>
  )
}

/** Reply, repost / quote, like, bookmark and share, with their counts. */
export function PostActionBar({ post }: { post: PostResponse }) {
  const me = useCurrentUser()
  const compose = useCompose()
  const actions = usePostActions()
  const own = post.author.id === me.id
  const locked = post.author.protectedAccount && !own

  const repostItems: MenuItem[] = [
    {
      label: post.repostedByMe ? 'Undo repost' : 'Repost',
      onSelect: () => void actions.toggleRepost(post),
      disabled: !post.repostedByMe && (own || locked),
      hint: own ? "You can't repost your own post." : 'Posts from protected accounts cannot be reposted.',
    },
    { label: 'Quote', onSelect: () => compose({ quoting: post }), disabled: locked, hint: 'Posts from protected accounts cannot be quoted.' },
  ]

  return (
    <div className="mt-1 -ml-2 flex" role="group" aria-label="Post actions">
      <Action
        label={post.canReply ? 'Reply' : 'Replies are limited by the author'}
        title={post.canReply ? 'Reply' : 'The author limits who can reply'}
        activeClass="" hoverClass="hover:bg-brand/10 hover:text-brand"
        disabled={!post.canReply} onClick={() => compose({ replyTo: post })} count={post.replyCount}
      >
        <MessageCircle size={18} />
      </Action>

      <DropdownMenu
        label={post.repostedByMe ? 'Repost (you reposted this)' : 'Repost'}
        pressed={post.repostedByMe}
        triggerClassName={`${base} ${post.repostedByMe ? 'text-green-500' : 'hover:bg-green-500/10 hover:text-green-500'}`}
        trigger={<><Repeat2 size={18} /><Count value={post.repostCount} /></>}
        items={repostItems}
      />

      <Action label={post.likedByMe ? 'Unlike' : 'Like'} active={post.likedByMe} activeClass="text-pink-500" hoverClass="hover:bg-pink-500/10 hover:text-pink-500" count={post.likeCount} onClick={() => void actions.toggleLike(post)}>
        <Heart size={18} className={post.likedByMe ? 'fill-current' : ''} />
      </Action>

      <Action label={post.bookmarkedByMe ? 'Remove bookmark' : 'Bookmark'} active={post.bookmarkedByMe} activeClass="text-brand" hoverClass="hover:bg-brand/10 hover:text-brand" onClick={() => void actions.toggleBookmark(post)}>
        <Bookmark size={18} className={post.bookmarkedByMe ? 'fill-current' : ''} />
      </Action>

      <Action label="Copy link to post" activeClass="" hoverClass="hover:bg-brand/10 hover:text-brand" onClick={() => void actions.share(post)}>
        <Link2 size={18} />
      </Action>
    </div>
  )
}
