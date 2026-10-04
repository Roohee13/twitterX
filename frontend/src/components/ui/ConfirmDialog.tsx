import { useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  children: ReactNode
  confirmLabel: string
  /** Red button, for things that are hard to undo. */
  danger?: boolean
  /** Return false to keep the dialog open (e.g. the request failed and a message was shown). */
  onConfirm: () => Promise<boolean | void>
  onClose: () => void
}

/** "Are you sure?" with a cancel and a confirm button. */
export function ConfirmDialog({ title, children, confirmLabel, danger = false, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    const result = await onConfirm()
    setBusy(false)
    if (result !== false) onClose()
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="text-zinc-400">{children}</div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => void confirm()} loading={busy}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}
