import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import type { PostResponse, ReplyPolicy } from '../../lib/types'
import { MAX_POST_LENGTH } from '../compose/Composer'
import { usePostActions, type ReportReason } from './usePostActions'

interface DialogProps {
  post: PostResponse
  onClose: () => void
}

export function EditPostDialog({ post, onClose }: DialogProps) {
  const actions = usePostActions()
  const [text, setText] = useState(post.content)
  const [saving, setSaving] = useState(false)
  const left = MAX_POST_LENGTH - text.length
  const unchanged = text.trim() === post.content
  const canSave = !saving && text.trim().length > 0 && left >= 0 && !unchanged

  async function save() {
    setSaving(true)
    const updated = await actions.editPost(post, text.trim())
    setSaving(false)
    if (updated) onClose()
  }

  return (
    <Modal open onClose={onClose} title="Edit post">
      <textarea aria-label="Post text" autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4} className="w-full resize-none rounded-md border border-zinc-700 bg-black p-3 text-lg focus:border-brand focus:outline-none" />
      <div className="mt-3 flex items-center justify-between">
        <span aria-label={left >= 0 ? `${left} characters left` : `${-left} characters over the limit`} className={left < 0 ? 'font-bold text-red-500' : 'text-zinc-500'}>{left}</span>
        <Button onClick={() => void save()} disabled={!canSave} loading={saving}>Save</Button>
      </div>
    </Modal>
  )
}

export function DeletePostDialog({ post, onClose, onDeleted }: DialogProps & { onDeleted?: () => void }) {
  const actions = usePostActions()
  const [deleting, setDeleting] = useState(false)

  async function remove() {
    setDeleting(true)
    const done = await actions.deletePost(post)
    setDeleting(false)
    if (done) {
      onClose()
      onDeleted?.()
    }
  }

  return (
    <Modal open onClose={onClose} title="Delete post?">
      <p className="text-zinc-400">This can't be undone. The post, its likes and its reposts are removed from everyone's timeline.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={() => void remove()} loading={deleting}>Delete</Button>
      </div>
    </Modal>
  )
}

const policies: Array<{ value: ReplyPolicy; label: string; hint: string }> = [
  { value: 'EVERYONE', label: 'Everyone', hint: 'Anyone who can see the post can reply.' },
  { value: 'FOLLOWING', label: 'People you follow', hint: 'Only accounts you follow can reply.' },
  { value: 'MENTIONED', label: 'Only people you mention', hint: 'Only accounts mentioned in the post can reply.' },
]

export function ReplyPolicyDialog({ post, onClose }: DialogProps) {
  const actions = usePostActions()
  const [value, setValue] = useState<ReplyPolicy>(post.replyPolicy)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const done = await actions.setReplyPolicy(post, value)
    setSaving(false)
    if (done) onClose()
  }

  return (
    <Modal open onClose={onClose} title="Who can reply?">
      <p className="mb-3 text-sm text-zinc-500">Applies to replies from now on. You can always reply to your own post.</p>
      <fieldset className="space-y-2">
        <legend className="sr-only">Who can reply</legend>
        {policies.map((p) => (
          <label key={p.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-800 p-3 hover:bg-zinc-900">
            <input type="radio" name="reply-policy" value={p.value} checked={value === p.value} onChange={() => setValue(p.value)} className="mt-1" />
            <span><span className="block font-semibold">{p.label}</span><span className="text-sm text-zinc-500">{p.hint}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="mt-4 flex justify-end"><Button onClick={() => void save()} loading={saving} disabled={value === post.replyPolicy}>Save</Button></div>
    </Modal>
  )
}

const reasons: Array<{ value: ReportReason; label: string }> = [
  { value: 'SPAM', label: "It's spam" },
  { value: 'HARASSMENT', label: "It's abusive or harassing" },
  { value: 'HATE_SPEECH', label: 'It contains hate speech' },
  { value: 'VIOLENCE', label: 'It promotes violence' },
  { value: 'SEXUAL_CONTENT', label: 'It contains sexual content' },
  { value: 'MISINFORMATION', label: "It's misleading" },
  { value: 'OTHER', label: 'Something else' },
]

export function ReportPostDialog({ post, onClose }: DialogProps) {
  const actions = usePostActions()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [sending, setSending] = useState(false)

  async function send() {
    if (!reason) return
    setSending(true)
    const done = await actions.report(post, reason)
    setSending(false)
    if (done) onClose()
  }

  return (
    <Modal open onClose={onClose} title="Report post">
      <fieldset className="space-y-1">
        <legend className="mb-2 text-zinc-400">What's wrong with this post?</legend>
        {reasons.map((r) => (
          <label key={r.value} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-zinc-900">
            <input type="radio" name="report-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
            {r.label}
          </label>
        ))}
      </fieldset>
      <div className="mt-4 flex justify-end"><Button onClick={() => void send()} loading={sending} disabled={!reason}>Report</Button></div>
    </Modal>
  )
}
