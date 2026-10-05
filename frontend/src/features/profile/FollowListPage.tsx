import { Lock } from 'lucide-react'
import { Link, NavLink, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { Avatar } from '../../components/ui/Avatar'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { Spinner } from '../../components/ui/Spinner'
import { EmptyState } from '../../components/ui/States'
import { ApiError } from '../../lib/api'
import { useCursorQuery } from '../../lib/queries'
import type { UserSummary } from '../../lib/types'
import { PageHeader } from '../shell/PageHeader'
import { profileKey, useProfile } from './profileData'

export function UserRow({ user }: { user: UserSummary }) {
  if (user.unavailable) {
    // A deactivated account: a plain row, no handle, no picture of theirs, nothing to open.
    return (
      <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <Avatar src={null} name="XClone user" />
        <span className="font-bold text-zinc-400">XClone user</span>
      </div>
    )
  }
  return (
    <Link to={`/u/${user.username}`} className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3 hover:bg-hover">
      <Avatar src={user.avatarUrl} name={user.displayName} />
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-bold">
          <span className="truncate">{user.displayName}</span>
          {user.protectedAccount && <Lock size={14} aria-label="Protected account" className="shrink-0 text-zinc-400" />}
        </span>
        <span className="block truncate text-zinc-500">@{user.username}</span>
      </span>
    </Link>
  )
}

/** Who follows an account, or who it follows (`kind`). Protected accounts show these only to approved followers. */
export function FollowListPage({ kind }: { kind: 'followers' | 'following' }) {
  const { username = '' } = useParams()
  const profile = useProfile(username)
  const list = useCursorQuery<UserSummary>([...profileKey(username), kind], `/api/users/${encodeURIComponent(username)}/${kind}`)
  const base = `/u/${username}`
  const tab = ({ isActive }: { isActive: boolean }) => `flex-1 py-4 text-center font-semibold hover:bg-zinc-900 ${isActive ? 'border-b-4 border-brand text-zinc-100' : 'text-zinc-500'}`

  return (
    <>
      <PageHeader title={profile.data?.displayName ?? username}>
        <Link to={base} aria-label="Back to profile" className="order-first -ml-2 rounded-full p-2 hover:bg-zinc-900"><ArrowLeft size={20} /></Link>
      </PageHeader>
      <nav aria-label="Followers and following" className="flex border-b border-zinc-800">
        <NavLink to={`${base}/followers`} className={tab}>Followers</NavLink>
        <NavLink to={`${base}/following`} className={tab}>Following</NavLink>
      </nav>
      {profile.isPending && <Spinner />}
      {profile.isError && <EmptyState title="This account doesn't exist" />}
      {profile.isSuccess && list.error instanceof ApiError && list.error.status === 403 ? (
        <EmptyState title="You can't see this list">{`Only people @${username} approves can see who they follow and who follows them.`}</EmptyState>
      ) : (
        profile.isSuccess && (
          <InfiniteList
            query={list}
            getKey={(user) => user.id}
            renderItem={(user) => <UserRow user={user} />}
            emptyTitle={kind === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
          />
        )
      )}
    </>
  )
}
