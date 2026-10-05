import { Link } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { InfiniteList } from '../../components/ui/InfiniteList'
import { Modal } from '../../components/ui/Modal'
import { useCursorQuery } from '../../lib/queries'
import type { UserSummary } from '../../lib/types'

/** A dialog listing people (newest first) from a paged endpoint; an unavailable account is a plain "XClone user" row without a link. */
export function PeopleDialog({ title, emptyTitle, queryKey, path, onClose }: {
  title: string
  emptyTitle: string
  queryKey: readonly unknown[]
  path: string
  onClose: () => void
}) {
  const people = useCursorQuery<UserSummary>(queryKey, path)
  return (
    <Modal open onClose={onClose} title={title}>
      <InfiniteList
        query={people}
        getKey={(user) => user.id}
        emptyTitle={emptyTitle}
        renderItem={(user) =>
          user.unavailable ? (
            <div className="flex items-center gap-3 p-2">
              <Avatar src={null} name="XClone user" />
              <span className="block truncate font-bold">XClone user</span>
            </div>
          ) : (
            <Link to={`/u/${user.username}`} onClick={onClose} className="flex items-center gap-3 rounded-lg p-2 hover:bg-zinc-900">
              <Avatar src={user.avatarUrl} name={user.displayName} />
              <span className="min-w-0">
                <span className="block truncate font-bold">{user.displayName}</span>
                <span className="block truncate text-zinc-500">@{user.username}</span>
              </span>
            </Link>
          )
        }
      />
    </Modal>
  )
}
