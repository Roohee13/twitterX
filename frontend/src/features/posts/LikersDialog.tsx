import { PeopleDialog } from './PeopleDialog'

/** The people who liked a post, newest first. */
export function LikersDialog({ postId, onClose }: { postId: number; onClose: () => void }) {
  return <PeopleDialog title="Liked by" emptyTitle="No likes yet" queryKey={['likers', postId]} path={`/api/posts/${postId}/likes`} onClose={onClose} />
}
