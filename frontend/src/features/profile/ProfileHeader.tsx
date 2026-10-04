import { CalendarDays, Lock } from 'lucide-react'
import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import type { ProfileResponse } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { PostText } from '../posts/PostText'
import { FollowButton } from './FollowButton'
import { ProfileMenu } from './ProfileMenu'

const joined = (iso: string) => new Date(iso).toLocaleDateString('en', { month: 'long', year: 'numeric' })

/** Banner, avatar, name, bio, counts, and the buttons that apply to you (edit your own profile, follow someone else's). */
export function ProfileHeader({ profile, onEdit }: { profile: ProfileResponse; onEdit: () => void }) {
  const me = useCurrentUser()
  const own = me.id === profile.id
  const base = `/u/${profile.username}`

  return (
    <header>
      <div className="h-32 bg-zinc-800 sm:h-48">
        {profile.bannerUrl && <img src={profile.bannerUrl} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-start justify-between">
          <Avatar src={profile.avatarUrl} name={profile.displayName} size="xl" className="-mt-14 border-4 border-black" />
          <div className="flex items-center gap-2 pt-3">
            {own ? (
              <Button variant="secondary" onClick={onEdit}>Edit profile</Button>
            ) : (
              <>
                <ProfileMenu profile={profile} />
                <FollowButton profile={profile} />
              </>
            )}
          </div>
        </div>

        <h2 className="mt-2 flex items-center gap-1 text-xl font-extrabold">
          {profile.displayName}
          {profile.protectedAccount && <Lock size={16} aria-label="Protected account" className="text-zinc-400" />}
        </h2>
        <p className="text-zinc-500">@{profile.username}{profile.mutedByMe && <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-xs">Muted</span>}</p>
        {profile.bio && <PostText content={profile.bio} mentions={[]} className="mt-3 text-[15px]" />}
        <p className="mt-3 flex items-center gap-1 text-zinc-500">
          <CalendarDays size={16} aria-hidden="true" />
          <span>Joined {joined(profile.createdAt)}</span>
        </p>
        <p className="mt-3 flex gap-5 text-[15px]">
          <Link to={`${base}/following`} className="hover:underline"><strong>{profile.followingCount}</strong> <span className="text-zinc-500">Following</span></Link>
          <Link to={`${base}/followers`} className="hover:underline"><strong>{profile.followerCount}</strong> <span className="text-zinc-500">{profile.followerCount === 1 ? 'Follower' : 'Followers'}</span></Link>
        </p>
      </div>
    </header>
  )
}
