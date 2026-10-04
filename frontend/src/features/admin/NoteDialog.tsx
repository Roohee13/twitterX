import { useId, useState, type ReactNode } from 'react'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'

interface NoteDialogProps {
  title: string
  children: ReactNode
  confirmLabel: string
  /** The admin's explanation, emailed to the person affected. Optional. */
  onConfirm: (note: string) => Promise<boolean>
  onClose: () => void
  /** For irreversible actions: the confirm button stays off until this exact text is typed. */
  typeToConfirm?: string
}

/** An "are you sure?" that also takes an optional reason, which goes to the user the action is about. */
export function NoteDialog({ title, children, confirmLabel, onConfirm, onClose, typeToConfirm }: NoteDialogProps) {
  const [note, setNote] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const noteId = useId()
  const typedId = useId()

  async function confirm() {
    setBusy(true)
    const ok = await onConfirm(note.trim())
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="text-zinc-400">{children}</div>
      <label htmlFor={noteId} className="mt-4 block text-sm font-semibold">Reason (optional, emailed to the user)</label>
      <textarea
        id={noteId}
        value={note}
        maxLength={500}
        rows={3}
        onChange={(e) => setNote(e.target.value)}
        className="mt-1 w-full resize-none rounded-md border border-zinc-700 bg-black px-3 py-2 focus:border-brand focus:outline-none"
      />
      {typeToConfirm && (
        <>
          <label htmlFor={typedId} className="mt-3 block text-sm font-semibold">Type {typeToConfirm} to confirm</label>
          <input
            id={typedId}
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-black px-3 py-2 focus:border-brand focus:outline-none"
          />
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" loading={busy} disabled={typeToConfirm !== undefined && typed !== typeToConfirm} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
