import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { Avatar } from '../../components/ui/Avatar'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { api } from '../../lib/api'
import type { UserSummary } from '../../lib/types'
import { useDebounced } from '../../lib/useDebounced'
import { useStartConversation } from './messageHooks'

/** Find someone by name or username and open a conversation with them. */
export function NewMessageDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const q = useDebounced(text.trim())
  const start = useStartConversation()
  const inputId = useId()
  const people = useQuery({
    queryKey: ['search', 'people', q],
    queryFn: ({ signal }) => api.get<UserSummary[]>(`/api/users/search?q=${encodeURIComponent(q)}`, { signal }),
    enabled: q.length > 0,
  })
  return (
    <Modal open onClose={onClose} title="New message">
      <label htmlFor={inputId} className="block text-sm font-semibold">Search people</label>
      <input id={inputId} autoFocus value={text} maxLength={100} onChange={(e) => setText(e.target.value)} placeholder="Name or @username"
        className="mt-1 w-full rounded-md border border-zinc-700 bg-black px-3 py-2 focus:border-brand focus:outline-none" />
      <div className="mt-3 max-h-80 overflow-y-auto" aria-live="polite">
        {q.length > 0 && people.isPending && <Spinner />}
        {people.isError && <p role="alert" className="py-4 text-center text-zinc-400">Search is unavailable right now.</p>}
        {people.data?.length === 0 && <p className="py-4 text-center text-zinc-500">No one found.</p>}
        {people.data?.map((user) => (
          <button key={user.id} type="button" onClick={() => void start(user.username).then((ok) => ok && onClose())}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-zinc-900">
            <Avatar src={user.avatarUrl} name={user.displayName} />
            <span className="min-w-0">
              <span className="block truncate font-bold">{user.displayName}</span>
              <span className="block truncate text-zinc-500">@{user.username}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
