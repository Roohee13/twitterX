import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/** A native <dialog>: the browser traps focus, closes on Esc and restores focus to the opener. */
export function Modal({ open, onClose, title, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-full max-w-lg rounded-2xl bg-black p-0 text-zinc-100 backdrop:bg-zinc-600/50"
    >
      <div className="flex items-center gap-4 border-b border-zinc-800 px-4 py-3">
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-zinc-900">
          <X size={20} />
        </button>
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      <div className="p-4">{open && children}</div>
    </dialog>
  )
}
