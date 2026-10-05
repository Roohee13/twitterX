import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import { useCursorQuery } from '../../lib/queries'
import type { CursorPage, UserSummary } from '../../lib/types'
import { profileKey } from '../profile/profileData'
import { invalidateFeeds } from '../../lib/feedCache'

type Kind = 'block' | 'mute'
const config = {
  block: { listKey: ['settings', 'blocks'], path: '/api/users/me/blocks', action: 'Unblock', title: 'Blocked accounts', empty: 'You have not blocked anyone', emptyText: 'Blocked accounts cannot see your posts, follow you or message you.' },
  mute: { listKey: ['settings', 'mutes'], path: '/api/users/me/mutes', action: 'Unmute', title: 'Muted accounts', empty: 'You have not muted anyone', emptyText: 'Muted accounts stay hidden from your timeline and notifications, and they are not told.' },
} as const

function Row({ user, kind }: { user: UserSummary; kind: Kind }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const { listKey, action } = config[kind]

  async function undo() {
    setBusy(true)
    try {
      await api.delete(`/api/users/${encodeURIComponent(user.username)}/${kind}`)
      queryClient.setQueryData<InfiniteData<CursorPage<UserSummary>>>(listKey, (old) =>
        old && { ...old, pages: old.pages.map((page) => ({ ...page, items: page.items.filter((u) => u.id !== user.id) })) })
      void queryClient.invalidateQueries({ queryKey: profileKey(user.username) })
      invalidateFeeds(queryClient)
      toast(`${kind === 'block' ? 'Unblocked' : 'Unmuted'} @${user.username}.`)
    } catch (e) {
      // 404/204 style races (already undone elsewhere) just mean the list is out of date.
      toast(e instanceof ApiError ? e.message : `Could not ${action.toLowerCase()} this account.`, 'error')
      void queryClient.invalidateQueries({ queryKey: listKey })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
      <Avatar src={user.avatarUrl} name={user.displayName} />
      <Link to={`/u/${user.username}`} className="min-w-0 flex-1">
        <span className="block truncate font-bold hover:underline">{user.displayName}</span>
        <span className="block truncate text-zinc-500">@{user.username}</span>
      </Link>
      <Button size="sm" variant="secondary" aria-label={`${action} @${user.username}`} loading={busy} onClick={() => void undo()}>{action}</Button>
    </div>
  )
}

/** The accounts you blocked or muted, each with a button to undo it. */
export function RelationList({ kind }: { kind: Kind }) {
  const { listKey, path, title, empty, emptyText } = config[kind]
  const list = useCursorQuery<UserSummary>(listKey, path, { staleTime: 5_000 })
  return (
    <section aria-label={title} className="border-b border-zinc-800">
      <h3 className="px-4 pt-5 text-lg font-bold">{title}</h3>
      <InfiniteList query={list} getKey={(u) => u.id} renderItem={(u) => <Row user={u} kind={kind} />} emptyTitle={empty} emptyText={emptyText} />
    </section>
  )
}
