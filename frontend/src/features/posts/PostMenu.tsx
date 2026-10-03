import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { DropdownMenu, type MenuItem } from '../../components/ui/DropdownMenu'
import type { PostResponse } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { DeletePostDialog, EditPostDialog, ReplyPolicyDialog, ReportPostDialog } from './PostDialogs'

type Dialog = 'edit' | 'delete' | 'policy' | 'report' | null

/** The "…" menu on a post: edit, delete and who-can-reply for your own posts, report for everyone else's. */
export function PostMenu({ post, afterDelete }: { post: PostResponse; afterDelete?: () => void }) {
  const me = useCurrentUser()
  const [dialog, setDialog] = useState<Dialog>(null)
  const own = post.author.id === me.id
  const topLevel = post.replyToId === null

  const items: MenuItem[] = own
    ? [
        { label: 'Edit post', onSelect: () => setDialog('edit') },
        ...(topLevel ? [{ label: 'Who can reply', onSelect: () => setDialog('policy') }] : []),
        { label: 'Delete post', onSelect: () => setDialog('delete'), danger: true },
      ]
    : [{ label: 'Report post', onSelect: () => setDialog('report') }]

  return (
    <>
      <DropdownMenu label="More actions" triggerClassName="rounded-full p-1.5 text-zinc-500 hover:bg-brand/10 hover:text-brand" trigger={<MoreHorizontal size={18} />} items={items} />
      {dialog === 'edit' && <EditPostDialog post={post} onClose={() => setDialog(null)} />}
      {dialog === 'policy' && <ReplyPolicyDialog post={post} onClose={() => setDialog(null)} />}
      {dialog === 'report' && <ReportPostDialog post={post} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeletePostDialog post={post} onClose={() => setDialog(null)} onDeleted={afterDelete} />}
    </>
  )
}

/** Same as PostMenu, but after deleting it leaves the page (used on a post's own page). */
export function PostMenuThatLeavesOnDelete({ post }: { post: PostResponse }) {
  const navigate = useNavigate()
  return <PostMenu post={post} afterDelete={() => navigate('/', { replace: true })} />
}
