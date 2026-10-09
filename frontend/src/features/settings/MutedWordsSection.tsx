import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { Field } from '../../components/ui/Field'
import { useToast } from '../../components/ui/Toast'
import { ApiError, api } from '../../lib/api'
import { invalidateFeeds } from '../../lib/feedCache'
import type { MutedWord } from '../../lib/types'

const KEY = ['settings', 'muted-words']
const MAX_LENGTH = 50

/** Words and phrases whose posts you do not want to see. Whole words only, any case; your own posts are never hidden from you. */
export function MutedWordsSection() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [word, setWord] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<number | null>(null)
  const list = useQuery({ queryKey: KEY, queryFn: () => api.get<MutedWord[]>('/api/muted-words'), staleTime: 5_000 })

  function changed() {
    void queryClient.invalidateQueries({ queryKey: KEY })
    invalidateFeeds(queryClient)
    void queryClient.invalidateQueries({ queryKey: ['search'] })
    void queryClient.invalidateQueries({ queryKey: ['hashtag'] })
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    const text = word.trim()
    if (!text) return
    setAdding(true)
    try {
      await api.post<MutedWord>('/api/muted-words', { word: text })
      setWord('')
      changed()
      toast(`Muted “${text}”.`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not mute that word.', 'error')
    } finally {
      setAdding(false)
    }
  }

  async function remove(item: MutedWord) {
    setRemoving(item.id)
    try {
      await api.delete(`/api/muted-words/${item.id}`)
      changed()
      toast(`Unmuted “${item.word}”.`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not unmute that word.', 'error')
    } finally {
      setRemoving(null)
    }
  }

  const words = list.data ?? []
  return (
    <section aria-label="Muted words" className="border-b border-zinc-800 px-4 py-5">
      <h3 className="text-lg font-bold">Muted words</h3>
      <p className="text-sm text-zinc-500">
        Posts containing these words or phrases are left out of your timelines, hashtag pages and search. Whole words only, upper or lower case. Your own posts are never hidden.
      </p>
      <form onSubmit={(e) => void add(e)} noValidate className="mt-3 flex items-end gap-2">
        <Field label="Word or phrase" value={word} maxLength={MAX_LENGTH} onChange={(e) => setWord(e.target.value)} className="min-w-0 flex-1" />
        <Button type="submit" loading={adding} disabled={!word.trim()}>Mute</Button>
      </form>
      {list.isError && <p role="alert" className="mt-3 text-sm text-red-400">Could not load your muted words.</p>}
      {list.isSuccess && words.length === 0 && <p className="mt-3 text-sm text-zinc-500">You have not muted any words.</p>}
      {words.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {words.map((item) => (
            <li key={item.id} className="flex items-center gap-1 rounded-full bg-zinc-800 py-1 pl-3 pr-1 text-sm">
              <span>{item.word}</span>
              <button
                type="button"
                aria-label={`Unmute ${item.word}`}
                disabled={removing === item.id}
                onClick={() => void remove(item)}
                className="rounded-full p-1 text-zinc-400 hover:bg-zinc-700 hover:text-white disabled:opacity-50"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
