import { PeopleDialog } from './PeopleDialog'

/** The people who reposted a post (plain reposts, the ones counted), newest first. */
export function RepostersDialog({ postId, onClose }: { postId: number; onClose: () => void }) {
  return <PeopleDialog title="Reposted by" emptyTitle="No reposts yet" queryKey={['reposters', postId]} path={`/api/posts/${postId}/reposts`} onClose={onClose} />
}
