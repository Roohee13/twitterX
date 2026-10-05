import { Lock } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Button } from '../../components/ui/Button'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { Spinner } from '../../components/ui/Spinner'
import { EmptyState } from '../../components/ui/States'
import { ApiError } from '../../lib/api'
import { useCursorQuery } from '../../lib/queries'
import type { PostResponse, ProfileResponse } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { PageHeader } from '../shell/PageHeader'
import { PostCard, postKey } from '../posts/PostCard'
import { EditProfileDialog } from './EditProfileDialog'
import { ProfileHeader } from './ProfileHeader'
import { UnavailableProfile } from './UnavailableProfile'
import { profileKey, useProfile, useProfileActions } from './profileData'

const TABS = [
  { id: 'posts', label: 'Posts', path: 'posts', empty: 'No posts yet', emptyOwn: "You haven't posted yet" },
  { id: 'replies', label: 'Replies', path: 'replies', empty: 'No replies yet', emptyOwn: "You haven't replied to anyone yet" },
  { id: 'likes', label: 'Likes', path: 'likes', empty: 'No likes yet', emptyOwn: "You haven't liked anything yet" },
] as const

type TabId = (typeof TABS)[number]['id']

function TabList({ current, onChange }: { current: TabId; onChange: (id: TabId) => void }) {
  return (
    <div role="tablist" aria-label="Profile sections" className="flex border-b border-zinc-800">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={current === tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 py-4 font-semibold hover:bg-zinc-900 ${current === tab.id ? 'border-b-4 border-brand text-zinc-100' : 'text-zinc-500'}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function TabContent({ profile, tab, own }: { profile: ProfileResponse; tab: (typeof TABS)[number]; own: boolean }) {
  const query = useCursorQuery<PostResponse>([...profileKey(profile.username), tab.id], `/api/users/${encodeURIComponent(profile.username)}/${tab.path}`)
  if (query.error instanceof ApiError && query.error.status === 403) {
    return <EmptyState title="You can't see these posts">{`@${profile.username}'s posts are not available to you.`}</EmptyState>
  }
  return <InfiniteList query={query} getKey={postKey} renderItem={(post) => <PostCard post={post} />} emptyTitle={own ? tab.emptyOwn : tab.empty} />
}

function Notice({ title, children, action }: { title: string; children: string; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <Lock size={32} className="mx-auto mb-3 text-zinc-500" aria-hidden="true" />
      <p className="text-xl font-bold">{title}</p>
      <p className="mt-2 text-zinc-500">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function Body({ profile, own }: { profile: ProfileResponse; own: boolean }) {
  const actions = useProfileActions(profile)
  const [params, setParams] = useSearchParams()
  const current = TABS.find((t) => t.id === params.get('tab')) ?? TABS[0]

  if (profile.blockedByMe) {
    return (
      <Notice
        title={`You blocked @${profile.username}`}
        action={<Button variant="secondary" onClick={() => void actions.unblock()}>Unblock</Button>}
      >
        Their posts are hidden while the block is on.
      </Notice>
    )
  }
  if (profile.protectedAccount && !profile.followedByMe && !own) {
    return (
      <Notice title="These posts are protected">
        {profile.followRequestedByMe
          ? `Your request is waiting for @${profile.username} to approve it.`
          : `Only people @${profile.username} approves can see their posts. Follow to send a request.`}
      </Notice>
    )
  }
  return (
    <>
      <TabList current={current.id} onChange={(id) => setParams(id === 'posts' ? {} : { tab: id }, { replace: true })} />
      <TabContent key={current.id} profile={profile} tab={current} own={own} />
    </>
  )
}

export function ProfilePage() {
  const { username = '' } = useParams()
  const me = useCurrentUser()
  const profile = useProfile(username)
  const [editing, setEditing] = useState(false)

  return (
    <>
      <PageHeader title={profile.data?.displayName ?? 'Profile'} />
      {profile.isPending && <Spinner />}
      {profile.isError && (
        <div role="alert">
          <EmptyState title={profile.error instanceof ApiError && profile.error.status === 404 ? "This account doesn't exist" : 'Something went wrong'}>
            {profile.error instanceof ApiError && profile.error.status === 404 ? 'Try searching for another name.' : profile.error.message}
          </EmptyState>
          <p className="pb-8 text-center"><Link to="/" className="font-semibold text-brand hover:underline">Go home</Link></p>
        </div>
      )}
      {profile.isSuccess && profile.data.unavailable && <UnavailableProfile />}
      {profile.isSuccess && !profile.data.unavailable && (
        <>
          <ProfileHeader profile={profile.data} onEdit={() => setEditing(true)} />
          <Body profile={profile.data} own={profile.data.id === me.id} />
          {editing && <EditProfileDialog profile={profile.data} onClose={() => setEditing(false)} />}
        </>
      )}
    </>
  )
}
