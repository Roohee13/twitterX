import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DropdownMenu, type MenuItem } from '../../components/ui/DropdownMenu'
import { useToast } from '../../components/ui/Toast'
import type { ProfileResponse } from '../../lib/types'
import { ReportDialog } from '../common/ReportDialog'
import { useProfileActions } from './profileData'

/** Mute, block and report another account. */
export function ProfileMenu({ profile }: { profile: ProfileResponse }) {
  const actions = useProfileActions(profile)
  const toast = useToast()
  const [dialog, setDialog] = useState<'block' | 'report' | null>(null)
  const handle = `@${profile.username}`

  const items: MenuItem[] = [
    profile.mutedByMe
      ? { label: `Unmute ${handle}`, onSelect: () => void actions.unmute().then((ok) => ok && toast(`Unmuted ${handle}.`)) }
      : { label: `Mute ${handle}`, onSelect: () => void actions.mute().then((ok) => ok && toast(`Muted ${handle}. You won't see their posts or notifications.`)) },
    profile.blockedByMe
      ? { label: `Unblock ${handle}`, onSelect: () => void actions.unblock() }
      : { label: `Block ${handle}`, onSelect: () => setDialog('block'), danger: true },
    { label: `Report ${handle}`, onSelect: () => setDialog('report') },
  ]

  return (
    <>
      <DropdownMenu label="Profile actions" triggerClassName="rounded-full border border-zinc-600 p-2 hover:bg-zinc-900" trigger={<MoreHorizontal size={18} />} items={items} />
      {dialog === 'block' && (
        <ConfirmDialog title={`Block ${handle}?`} confirmLabel="Block" danger onConfirm={actions.block} onClose={() => setDialog(null)}>
          You will stop following each other, and neither of you will see the other's posts or be able to follow, like or reply to the other.
        </ConfirmDialog>
      )}
      {dialog === 'report' && <ReportDialog title={`Report ${handle}`} onReport={actions.report} onClose={() => setDialog(null)} />}
    </>
  )
}
