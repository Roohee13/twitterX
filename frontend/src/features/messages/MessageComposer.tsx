import { SendHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'

const MAX = 2000

/** Enter sends, Shift+Enter starts a new line. The box clears at once; the chat shows the message as "Sending…". */
export function MessageComposer({ onSend }: { onSend: (content: string) => void }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const trimmed = text.trim()

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={submit} className="sticky bottom-16 z-10 flex items-end gap-2 border-t border-zinc-800 bg-black px-3 py-2 sm:bottom-0">
      <textarea
        ref={box}
        aria-label="Message"
        placeholder="Write a message"
        rows={1}
        maxLength={MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        className="max-h-40 min-h-[44px] flex-1 resize-none rounded-2xl border border-zinc-700 bg-black px-4 py-2.5 focus:border-brand focus:outline-none"
      />
      {text.length > MAX - 200 && <span className={`pb-3 text-sm ${text.length >= MAX ? 'text-red-400' : 'text-zinc-500'}`}>{MAX - text.length}</span>}
      <button type="submit" aria-label="Send message" disabled={!trimmed} className="mb-0.5 rounded-full bg-brand p-2.5 text-white hover:bg-brand-hover disabled:opacity-50">
        <SendHorizontal size={20} />
      </button>
    </form>
  )
}
