import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import type { ProfileResponse } from '../../lib/types'
import { useProfileActions } from './profileData'

/** Follow / Following / Requested / Blocked, whichever applies. Leaving a follow or a block asks first; withdrawing a request does not. */
export function FollowButton({ profile }: { profile: ProfileResponse }) {
  const actions = useProfileActions(profile)
  const [dialog, setDialog] = useState<'unfollow' | 'unblock' | null>(null)
  const handle = `@${profile.username}`

  let button
  if (profile.blockedByMe) {
    button = <Button variant="danger" aria-label={`Unblock ${handle}`} onClick={() => setDialog('unblock')}>Blocked</Button>
  } else if (profile.followedByMe) {
    button = <Button variant="secondary" aria-label={`Unfollow ${handle}`} onClick={() => setDialog('unfollow')}>Following</Button>
  } else if (profile.followRequestedByMe) {
    button = <Button variant="secondary" aria-label={`Withdraw follow request to ${handle}`} onClick={() => void actions.unfollow()}>Requested</Button>
  } else {
    button = <Button aria-label={`Follow ${handle}`} onClick={() => void actions.follow()}>Follow</Button>
  }

  return (
    <>
      {button}
      {dialog === 'unfollow' && (
        <ConfirmDialog title={`Unfollow ${handle}?`} confirmLabel="Unfollow" onConfirm={actions.unfollow} onClose={() => setDialog(null)}>
          {profile.protectedAccount
            ? `Their posts are protected, so you will stop seeing them and have to ask to follow again.`
            : `Their posts will no longer appear in your timeline.`}
        </ConfirmDialog>
      )}
      {dialog === 'unblock' && (
        <ConfirmDialog title={`Unblock ${handle}?`} confirmLabel="Unblock" onConfirm={actions.unblock} onClose={() => setDialog(null)}>
          They will be able to see your posts and follow you again. Blocking removed any follows, so neither of you follows the other now.
        </ConfirmDialog>
      )}
    </>
  )
}
