import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { ErrorState } from '../../components/ui/States'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import type { ConversationResponse, GroupMember } from '../../lib/types'
import { useCurrentUser } from '../auth/AuthContext'
import { MAX_GROUP_MEMBERS, MAX_GROUP_TITLE, membersKey } from './messageHooks'
import { applyConversationUpdate, removeConversationLocally } from './messageCache'
import { PeopleSearch } from './PeopleSearch'

type Panel = 'info' | 'add'

/** A group's name and members. Anyone in it can add people or leave; only the owner renames it or removes others. */
export function GroupInfoDialog({ conversation, onClose }: { conversation: ConversationResponse; onClose: () => void }) {
  const me = useCurrentUser()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const [panel, setPanel] = useState<Panel>('info')
  const [title, setTitle] = useState(conversation.title ?? '')
  const [saving, setSaving] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [removing, setRemoving] = useState<GroupMember | null>(null)
  const members = useQuery({ queryKey: membersKey(conversation.id), queryFn: () => api.get<GroupMember[]>(`/api/conversations/${conversation.id}/members`) })
  const owner = members.data?.some((m) => m.user.id === me.id && m.role === 'OWNER') ?? false
  const trimmed = title.trim()
  const full = (members.data?.length ?? 0) >= MAX_GROUP_MEMBERS

  function fail(e: unknown, fallback: string) {
    toast(e instanceof ApiError ? e.message : fallback, 'error')
  }

  async function rename() {
    setSaving(true)
    try {
      const saved = await api.patch<ConversationResponse>(`/api/conversations/${conversation.id}`, { title: trimmed })
      await applyConversationUpdate(queryClient, { conversationId: saved.id, removed: false, conversation: saved })
    } catch (e) {
      fail(e, 'Could not rename the group.')
    }
    setSaving(false)
  }

  async function add(username: string) {
    try {
      await api.post<GroupMember[]>(`/api/conversations/${conversation.id}/members`, { usernames: [username] })
      await queryClient.invalidateQueries({ queryKey: ['messages'] })
      setPanel('info')
    } catch (e) {
      fail(e, 'Could not add that person.')
    }
  }

  async function remove(member: GroupMember): Promise<boolean> {
    try {
      await api.delete(`/api/conversations/${conversation.id}/members/${member.user.id}`)
    } catch (e) {
      fail(e, 'Could not remove that person.')
      return false
    }
    await queryClient.invalidateQueries({ queryKey: ['messages'] })
    return true
  }

  async function leave(): Promise<boolean> {
    try {
      await api.post(`/api/conversations/${conversation.id}/leave`)
    } catch (e) {
      fail(e, 'Could not leave the group.')
      return false
    }
    navigate('/messages', { replace: true })
    toast('You left the group.')
    void removeConversationLocally(queryClient, conversation.id)
    return true
  }

  return (
    <Modal open onClose={onClose} title="Group info">
      {panel === 'add' ? (
        <>
          <PeopleSearch label="Add people" exclude={members.data?.map((m) => m.user.id)} onPick={(user) => void add(user.username)} />
          <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={() => setPanel('info')}>Back</Button></div>
        </>
      ) : (
        <>
          {owner ? (
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (trimmed && trimmed !== conversation.title) void rename() }}>
              <label className="min-w-0 flex-1 text-sm font-semibold">
                Group name
                <input value={title} maxLength={MAX_GROUP_TITLE} onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-black px-3 py-2 font-normal focus:border-brand focus:outline-none" />
              </label>
              <Button type="submit" loading={saving} disabled={!trimmed || trimmed === conversation.title}>Save</Button>
            </form>
          ) : (
            <p className="text-lg font-bold">{conversation.title}</p>
          )}
          <div className="mt-4 flex items-center justify-between">
            <h3 className="font-bold">Members{members.data ? ` (${members.data.length})` : ''}</h3>
            <Button size="sm" variant="secondary" disabled={full || !members.data} onClick={() => setPanel('add')}>Add people</Button>
          </div>
          {members.isPending && <Spinner />}
          {members.isError && <ErrorState message="Could not load the members." onRetry={() => void members.refetch()} />}
          <ul className="mt-2 max-h-72 overflow-y-auto">
            {members.data?.map((m) => (
              <li key={m.user.id} className="flex items-center gap-3 py-2">
                <Avatar src={m.user.unavailable ? null : m.user.avatarUrl} name={m.user.displayName} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{m.user.displayName}{m.user.id === me.id ? ' (you)' : ''}</span>
                  {!m.user.unavailable && <span className="block truncate text-zinc-500">@{m.user.username}</span>}
                </span>
                {m.role === 'OWNER' && <span className="rounded-full border border-zinc-700 px-2 text-xs text-zinc-400">Owner</span>}
                {owner && m.user.id !== me.id && (
                  <Button size="sm" variant="secondary" aria-label={`Remove ${m.user.displayName}`} onClick={() => setRemoving(m)}>Remove</Button>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <Button variant="danger" onClick={() => setLeaving(true)}>Leave group</Button>
          </div>
        </>
      )}
      {leaving && (
        <ConfirmDialog title="Leave this group?" confirmLabel="Leave" danger onConfirm={leave} onClose={() => setLeaving(false)}>
          You stop receiving its messages and it disappears from your messages. The others keep the conversation. Someone in the group can add you back.
        </ConfirmDialog>
      )}
      {removing && (
        <ConfirmDialog title={`Remove ${removing.user.displayName}?`} confirmLabel="Remove" danger onConfirm={() => remove(removing)} onClose={() => setRemoving(null)}>
          They can no longer read or write in this group.
        </ConfirmDialog>
      )}
    </Modal>
  )
}
