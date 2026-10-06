import { ImagePlus, SendHorizontal, X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { ApiError } from '../../lib/api'
import { ALLOWED_IMAGE_TYPES, MAX_IMAGES_PER_MESSAGE, uploadImage, validateImage } from '../../lib/upload'

const MAX = 2000

interface Photo {
  id: string
  previewUrl: string
  status: 'uploading' | 'done' | 'error'
  progress: number
  key?: string
  error?: string
  abort: AbortController
}

/** What the chat gets when the person sends: text, uploaded photo keys, and the local previews to show while it is on its way. */
export interface Outgoing {
  content: string
  mediaKeys: string[]
  previews: string[]
}

/**
 * Enter sends, Shift+Enter starts a new line. Photos (up to four) upload as soon as they are chosen; a message can be text, photos or both.
 * The box clears at once; the chat shows the message as "Sending…".
 */
export function MessageComposer({ onSend }: { onSend: (message: Outgoing) => void }) {
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const latest = useRef(photos)
  useEffect(() => {
    latest.current = photos // the unmount cleanup needs the newest list
  })
  const trimmed = text.trim()
  const uploading = photos.some((p) => p.status === 'uploading')
  const failed = photos.some((p) => p.status === 'error')
  const ready = photos.filter((p) => p.status === 'done')
  const canSend = (trimmed.length > 0 || ready.length > 0) && !uploading && !failed

  // Leaving the chat cancels unfinished uploads and frees the previews of photos that were never sent.
  useEffect(
    () => () => {
      for (const photo of latest.current) {
        photo.abort.abort()
        URL.revokeObjectURL(photo.previewUrl)
      }
    },
    [],
  )

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])

  const updatePhoto = (id: string, change: Partial<Photo>) => setPhotos((list) => list.map((p) => (p.id === id ? { ...p, ...change } : p)))

  function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = '' // lets the same file be chosen again after removing it
    const room = Math.max(MAX_IMAGES_PER_MESSAGE - photos.length, 0)
    const problems = files.map(validateImage).filter((p): p is string => p !== null)
    const accepted = files.filter((f) => validateImage(f) === null).slice(0, room)
    if (files.length > accepted.length + problems.length) problems.push(`A message can have at most ${MAX_IMAGES_PER_MESSAGE} photos.`)
    setError(problems[0] ?? null)

    for (const file of accepted) {
      const photo: Photo = { id: crypto.randomUUID(), previewUrl: URL.createObjectURL(file), status: 'uploading', progress: 0, abort: new AbortController() }
      setPhotos((list) => [...list, photo])
      uploadImage(file, (progress) => updatePhoto(photo.id, { progress }), photo.abort.signal)
        .then(({ key }) => updatePhoto(photo.id, { status: 'done', key, progress: 1 }))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return
          updatePhoto(photo.id, { status: 'error', error: e instanceof ApiError ? e.message : 'Upload failed.' })
        })
    }
  }

  function removePhoto(photo: Photo) {
    photo.abort.abort()
    URL.revokeObjectURL(photo.previewUrl)
    setPhotos((list) => list.filter((p) => p.id !== photo.id))
    setError(null)
  }

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!canSend) return
    // The previews now belong to the chat (it shows them until the server has the message), so they are not freed here.
    onSend({ content: trimmed, mediaKeys: ready.flatMap((p) => (p.key ? [p.key] : [])), previews: ready.map((p) => p.previewUrl) })
    setText('')
    setPhotos([])
    setError(null)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={submit} className="sticky bottom-16 z-10 border-t border-zinc-800 bg-black px-3 py-2 sm:bottom-0">
      {photos.length > 0 && (
        <ul className="mb-2 grid grid-cols-4 gap-2" aria-label="Photos to send">
          {photos.map((photo) => (
            <li key={photo.id} className="relative overflow-hidden rounded-xl border border-zinc-800">
              <img src={photo.previewUrl} alt="Selected photo preview" className="h-20 w-full object-cover" />
              {photo.status === 'uploading' && (
                <div role="progressbar" aria-label="Uploading photo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(photo.progress * 100)} className="absolute inset-x-0 bottom-0 h-1 bg-zinc-800">
                  <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(photo.progress, 0.05) * 100}%` }} />
                </div>
              )}
              {photo.status === 'error' && <p role="alert" className="absolute inset-x-0 bottom-0 bg-red-600/90 px-1 py-0.5 text-xs">{photo.error}</p>}
              <button type="button" aria-label="Remove photo" onClick={() => removePhoto(photo)} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 hover:bg-black">
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mb-2 text-sm text-red-400">{error}</p>}
      <div className="flex items-end gap-2">
        <input ref={fileInput} type="file" hidden multiple accept={ALLOWED_IMAGE_TYPES.join(',')} aria-label="Choose photos" onChange={addPhotos} />
        <button
          type="button"
          aria-label="Add photos"
          title="Add photos"
          disabled={photos.length >= MAX_IMAGES_PER_MESSAGE}
          onClick={() => fileInput.current?.click()}
          className="mb-0.5 rounded-full p-2.5 text-brand hover:bg-brand/10 disabled:opacity-40"
        >
          <ImagePlus size={20} />
        </button>
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
        <button type="submit" aria-label="Send message" disabled={!canSend} className="mb-0.5 rounded-full bg-brand p-2.5 text-white hover:bg-brand-solid-hover disabled:opacity-50">
          <SendHorizontal size={20} />
        </button>
      </div>
    </form>
  )
}
