import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Why the item is unavailable, shown as a tooltip. */
  hint?: string
  danger?: boolean
}

interface DropdownMenuProps {
  /** Accessible name of the button that opens the menu. */
  label: string
  trigger: ReactNode
  items: MenuItem[]
  triggerClassName?: string
  pressed?: boolean
}

/** A button that opens a small menu: closes on outside click, Escape or choosing an item; arrow keys move between items. */
export function DropdownMenu({ label, trigger, items, triggerClassName = '', pressed }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      setOpen(false)
      button.current?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const enabled = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    const at = enabled.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % enabled.length : (at - 1 + enabled.length) % enabled.length
    enabled[next]?.focus()
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-pressed={pressed}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className="absolute right-0 top-full z-30 mt-1 min-w-52 overflow-hidden rounded-xl border border-zinc-700 bg-black py-1 shadow-xl shadow-white/5">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.disabled ? item.hint : undefined}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={`block w-full px-4 py-2.5 text-left font-semibold hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent ${item.danger ? 'text-red-500' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
