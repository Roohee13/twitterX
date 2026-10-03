import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { Modal } from '../../components/ui/Modal'
import { useCursorQuery } from '../../lib/queries'
import type { UserSummary } from '../../lib/types'

/** The people who liked a post, newest first. */
export function LikersDialog({ postId, onClose }: { postId: number; onClose: () => void }) {
  const likers = useCursorQuery<UserSummary>(['likers', postId], `/api/posts/${postId}/likes`)
  return (
    <Modal open onClose={onClose} title="Liked by">
      <InfiniteList
        query={likers}
        getKey={(user) => user.id}
        emptyTitle="No likes yet"
        renderItem={(user) => (
          <Link to={`/u/${user.username}`} onClick={onClose} className="flex items-center gap-3 rounded-lg p-2 hover:bg-zinc-900">
            <Avatar src={user.avatarUrl} name={user.displayName} />
            <span className="min-w-0">
              <span className="block truncate font-bold">{user.displayName}</span>
              <span className="block truncate text-zinc-500">@{user.username}</span>
            </span>
          </Link>
        )}
      />
    </Modal>
  )
}
