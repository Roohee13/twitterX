import { X } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import type { UserSummary } from '../../lib/types'
import { PeopleSearch } from './PeopleSearch'
import { MAX_GROUP_MEMBERS, MAX_GROUP_TITLE, useCreateGroup } from './messageHooks'

/** Name a group, pick the people to start it with, and open it. You become its owner. */
export function NewGroupDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState<UserSummary[]>([])
  const [busy, setBusy] = useState(false)
  const createGroup = useCreateGroup()
  const titleId = useId()
  const full = picked.length >= MAX_GROUP_MEMBERS - 1
  const ready = title.trim().length > 0 && picked.length > 0

  async function create() {
    setBusy(true)
    const ok = await createGroup(title.trim(), picked.map((user) => user.username))
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal open onClose={onClose} title="New group">
      <label htmlFor={titleId} className="block text-sm font-semibold">Group name</label>
      <input id={titleId} autoFocus value={title} maxLength={MAX_GROUP_TITLE} onChange={(e) => setTitle(e.target.value)}
        className="mt-1 mb-4 w-full rounded-md border border-zinc-700 bg-black px-3 py-2 focus:border-brand focus:outline-none" />
      {picked.length > 0 && (
        <ul aria-label="Selected people" className="mb-3 flex flex-wrap gap-2">
          {picked.map((user) => (
            <li key={user.id} className="flex items-center gap-1 rounded-full bg-zinc-800 py-1 pr-1 pl-3 text-sm">
              <span>{user.displayName}</span>
              <button type="button" aria-label={`Remove ${user.displayName}`} onClick={() => setPicked((p) => p.filter((x) => x.id !== user.id))}
                className="rounded-full p-1 hover:bg-zinc-700"><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      {full ? (
        <p role="status" className="py-2 text-sm text-zinc-500">A group can have at most {MAX_GROUP_MEMBERS} people, you included.</p>
      ) : (
        <PeopleSearch label="Add people" exclude={picked.map((user) => user.id)} onPick={(user) => setPicked((p) => [...p, user])} />
      )}
      <div className="mt-4 flex justify-end">
        <Button disabled={!ready} loading={busy} onClick={() => void create()}>Create group</Button>
      </div>
    </Modal>
  )
}
