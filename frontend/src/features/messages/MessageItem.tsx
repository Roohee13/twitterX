import { useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { DropdownMenu } from '../../components/ui/DropdownMenu'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import type { MessageResponse } from '../../lib/types'
import { MessageBubble } from './MessageBubble'
import { replaceMessage } from './messageCache'

const MAX = 2000

/** Edit the text in place: Enter saves, Shift+Enter makes a new line, Escape (or Cancel) leaves it as it was. */
function MessageEditor({ message, onDone }: { message: MessageResponse; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState(message.content)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const trimmed = text.trim()
  const hasPhotos = (message.mediaUrls?.length ?? 0) > 0 // a photo message may lose its text

  async function save() {
    if (!trimmed && !hasPhotos) return setError('A message cannot be empty')
    if (trimmed === message.content) return onDone() // nothing changed
    setBusy(true)
    try {
      const saved = await api.patch<MessageResponse>(`/api/conversations/${message.conversationId}/messages/${message.id}`, { content: trimmed })
      await replaceMessage(queryClient, saved)
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the change.')
      setBusy(false)
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onDone()
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void save()
    }
  }

  return (
    <div className="ml-auto w-full max-w-[85%] space-y-2">
      <textarea
        aria-label="Edit message"
        autoFocus
        rows={2}
        maxLength={MAX}
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null) }}
        onKeyDown={onKeyDown}
        className="w-full resize-none rounded-2xl border border-brand bg-black px-4 py-2.5 focus:outline-none"
      />
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button size="sm" loading={busy} disabled={!trimmed && !hasPhotos} onClick={() => void save()}>Save</Button>
      </div>
    </div>
  )
}

/** One message in the chat. Your own messages have a menu to edit or delete them; a deleted one shows a placeholder. */
/**
 * `readOnly`: the other person's account is unavailable, so nothing in this conversation can be changed any more.
 * `showSender`: a group, where the name of whoever else wrote it is shown above their message.
 */
export function MessageItem({ message, mine, readOnly = false, showSender = false }: { message: MessageResponse; mine: boolean; readOnly?: boolean; showSender?: boolean }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function remove(): Promise<boolean> {
    try {
      await api.delete(`/api/conversations/${message.conversationId}/messages/${message.id}`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not delete the message.', 'error')
      return false
    }
    await replaceMessage(queryClient, { ...message, content: '', deleted: true, mediaUrls: [] })
    return true
  }

  if (editing) return <MessageEditor message={message} onDone={() => setEditing(false)} />

  const canChange = mine && !message.deleted && !readOnly
  return (
    <>
      {showSender && !mine && <p className="mt-1 px-1 text-xs font-semibold text-zinc-400">{message.sender.displayName}</p>}
      <MessageBubble
        content={message.content}
        mediaUrls={message.mediaUrls}
        createdAt={message.createdAt}
        mine={mine}
        edited={message.editedAt !== null}
        deleted={message.deleted}
        actions={canChange && (
          <DropdownMenu
            label="Message actions"
            opensUp
            triggerClassName="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
            trigger={<MoreHorizontal size={16} />}
            items={[
              { label: 'Edit', onSelect: () => setEditing(true) },
              { label: 'Delete', onSelect: () => setConfirming(true), danger: true },
            ]}
          />
        )}
      />
      {confirming && (
        <ConfirmDialog title="Delete this message?" confirmLabel="Delete" danger onConfirm={remove} onClose={() => setConfirming(false)}>
          It is deleted for {showSender ? 'everyone in the group' : 'both of you'} and cannot be brought back. A note that a message was deleted stays in the conversation.
        </ConfirmDialog>
      )}
    </>
  )
}
