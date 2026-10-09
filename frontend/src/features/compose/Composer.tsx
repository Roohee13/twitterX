import { ChartNoAxesColumn, ImagePlus, Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { ApiError, api } from '../../lib/api'
import type { PostResponse, ReplyPolicy } from '../../lib/types'
import { ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES, MAX_IMAGES_PER_POST, isVideoFile, uploadImage, validateImage, validateVideo } from '../../lib/upload'
import { useCurrentUser } from '../auth/AuthContext'
import { PostMedia } from '../posts/PostMedia'
import { PostText } from '../posts/PostText'
import { PostHeader } from '../posts/PostHeader'

export const MAX_POST_LENGTH = 280
export const MAX_THREAD_POSTS = 25
export const MAX_POLL_OPTIONS = 4
export const MAX_POLL_OPTION_LENGTH = 25

/** How long a poll stays open, in minutes. */
const POLL_DURATIONS = [
  { minutes: 60, label: '1 hour' },
  { minutes: 360, label: '6 hours' },
  { minutes: 1440, label: '1 day' },
  { minutes: 4320, label: '3 days' },
  { minutes: 10080, label: '7 days' },
]

interface PollDraft {
  options: string[]
  minutes: number
}

const newPoll = (): PollDraft => ({ options: ['', ''], minutes: 1440 })

/** At least two different, non-empty options. */
function pollIsValid(poll: PollDraft): boolean {
  const filled = poll.options.map((o) => o.trim()).filter(Boolean)
  return filled.length >= 2 && new Set(filled.map((o) => o.toLowerCase())).size === filled.length
}

interface ImageDraft {
  id: string
  /** True for the one video a post may carry instead of images. */
  video: boolean
  previewUrl: string
  status: 'uploading' | 'done' | 'error'
  progress: number
  key?: string
  error?: string
  abort: AbortController
}

interface Draft {
  id: string
  text: string
  images: ImageDraft[]
}

const newDraft = (): Draft => ({ id: crypto.randomUUID(), text: '', images: [] })

const policyLabels: Record<ReplyPolicy, string> = {
  EVERYONE: 'Everyone can reply',
  FOLLOWING: 'People you follow can reply',
  MENTIONED: 'Only people you mention can reply',
}

interface ComposerProps {
  /** Replying to this post: the new post is its reply. */
  replyTo?: PostResponse
  /** Quoting this post. */
  quoting?: PostResponse
  placeholder?: string
  autoFocus?: boolean
  submitLabel?: string
  /** Show the post being replied to above the box. Off where that post is already on screen. */
  showReplyContext?: boolean
  onPosted?: (posts: PostResponse[]) => void
}

/** Writes a post (or, for new top-level posts, a thread of 2-25), with up to four images each, uploaded as soon as they are chosen. */
export function Composer({ replyTo, quoting, placeholder = "What's happening?", autoFocus = false, submitLabel = 'Post', showReplyContext = true, onPosted }: ComposerProps) {
  const user = useCurrentUser()
  const [items, setItems] = useState<Draft[]>([newDraft()])
  const [policy, setPolicy] = useState<ReplyPolicy>('EVERYONE')
  const [poll, setPoll] = useState<PollDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputs = useRef(new Map<string, HTMLInputElement>())
  const latest = useRef(items)
  useEffect(() => {
    latest.current = items // the unmount cleanup below needs the newest drafts
  })
  const policyId = useId()

  const isTopLevel = !replyTo && !quoting
  const isThread = items.length > 1

  // Leaving the composer cancels unfinished uploads and frees the preview images.
  useEffect(
    () => () => {
      for (const draft of latest.current) for (const image of draft.images) {
        image.abort.abort()
        URL.revokeObjectURL(image.previewUrl)
      }
    },
    [],
  )

  const updateDraft = (id: string, change: (draft: Draft) => Draft) => setItems((list) => list.map((d) => (d.id === id ? change(d) : d)))
  const updateImage = (draftId: string, imageId: string, change: Partial<ImageDraft>) =>
    updateDraft(draftId, (d) => ({ ...d, images: d.images.map((i) => (i.id === imageId ? { ...i, ...change } : i)) }))

  function addImages(draft: Draft, event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = '' // lets the same file be chosen again after removing it
    let accepted: File[]
    const problems: string[] = []
    if (files.some(isVideoFile) || draft.images.some((i) => i.video)) {
      // A post carries either one video or up to four images, never both.
      const mixed = files.length > 1 || draft.images.length > 0
      if (mixed) problems.push('A post can have one video, or up to four images, not both.')
      const problem = mixed ? null : validateVideo(files[0])
      if (problem) problems.push(problem)
      accepted = mixed || problem ? [] : [files[0]]
    } else {
      const room = MAX_IMAGES_PER_POST - draft.images.length
      problems.push(...files.map(validateImage).filter((p): p is string => p !== null))
      accepted = files.filter((f) => validateImage(f) === null).slice(0, Math.max(room, 0))
      if (files.length > accepted.length + problems.length) problems.push(`A post can have at most ${MAX_IMAGES_PER_POST} images.`)
    }
    setError(problems[0] ?? null)

    for (const file of accepted) {
      const image: ImageDraft = { id: crypto.randomUUID(), video: isVideoFile(file), previewUrl: URL.createObjectURL(file), status: 'uploading', progress: 0, abort: new AbortController() }
      updateDraft(draft.id, (d) => ({ ...d, images: [...d.images, image] }))
      uploadImage(file, (progress) => updateImage(draft.id, image.id, { progress }), image.abort.signal)
        .then(({ key }) => updateImage(draft.id, image.id, { status: 'done', key, progress: 1 }))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return
          updateImage(draft.id, image.id, { status: 'error', error: e instanceof ApiError ? e.message : 'Upload failed.' })
        })
    }
  }

  function removeImage(draft: Draft, image: ImageDraft) {
    image.abort.abort()
    URL.revokeObjectURL(image.previewUrl)
    updateDraft(draft.id, (d) => ({ ...d, images: d.images.filter((i) => i.id !== image.id) }))
  }

  const pollAllowed = isTopLevel && !isThread && items[0].images.length === 0
  const hasContent = (d: Draft) => d.text.trim().length > 0 || d.images.some((i) => i.status === 'done') || (d === items[0] && poll !== null && pollIsValid(poll))
  const uploading = items.some((d) => d.images.some((i) => i.status === 'uploading'))
  const tooLong = items.some((d) => d.text.length > MAX_POST_LENGTH)
  const failedImage = items.some((d) => d.images.some((i) => i.status === 'error'))
  const canSubmit = !submitting && !uploading && !tooLong && !failedImage && items.every(hasContent) && (poll === null || pollIsValid(poll))

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const posts = items.map((d) => {
      const mediaKeys = d.images.flatMap((i) => (i.key ? [i.key] : []))
      return { content: d.text.trim(), ...(mediaKeys.length > 0 ? { mediaKeys } : {}) }
    })
    if (poll && !isThread) {
      Object.assign(posts[0], { poll: { options: poll.options.map((o) => o.trim()).filter(Boolean), durationMinutes: poll.minutes } })
    }
    try {
      const created = isThread
        ? await api.post<PostResponse[]>('/api/posts/thread', { posts, replyPolicy: policy })
        : [
            await api.post<PostResponse>('/api/posts', {
              ...posts[0],
              ...(replyTo ? { replyToId: replyTo.id } : {}),
              ...(quoting ? { quotedPostId: quoting.id } : {}),
              ...(isTopLevel ? { replyPolicy: policy } : {}),
            }),
          ]
      for (const draft of items) for (const image of draft.images) URL.revokeObjectURL(image.previewUrl)
      setItems([newDraft()])
      setPoll(null)
      onPosted?.(created)
    } catch (e) {
      setError(e instanceof ApiError ? (e.fieldErrors.content ?? e.message) : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div onKeyDown={onKeyDown}>
      {replyTo && showReplyContext && (
        <div className="mb-3 rounded-2xl border border-zinc-800 p-3" role="group" aria-label={`Replying to ${replyTo.author.displayName}`}>
          <PostHeader author={replyTo.author} createdAt={replyTo.createdAt} />
          <PostText content={replyTo.content} mentions={replyTo.mentions} className="line-clamp-4 text-[15px]" />
          <p className="mt-2 text-sm text-zinc-500">Replying to <span className="text-brand">@{replyTo.author.username}</span></p>
        </div>
      )}

      {items.map((draft, index) => (
        <div key={draft.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <Avatar src={user.avatarUrl} name={user.displayName} />
            {index < items.length - 1 && <div aria-hidden="true" className="mt-1 w-0.5 flex-1 bg-zinc-700" />}
          </div>
          <div className="min-w-0 flex-1 pb-3">
            <div className="flex items-start gap-2">
              <textarea
                aria-label={isThread ? `Post ${index + 1} of ${items.length}` : 'Post text'}
                placeholder={index === 0 ? placeholder : 'Add to the thread'}
                autoFocus={autoFocus && index === 0}
                value={draft.text}
                onChange={(e) => updateDraft(draft.id, (d) => ({ ...d, text: e.target.value }))}
                rows={2}
                className="min-h-14 w-full resize-none bg-transparent py-2 text-xl placeholder:text-zinc-600 [field-sizing:content] focus:outline-none"
              />
              {index > 0 && (
                <button type="button" aria-label={`Remove post ${index + 1}`} onClick={() => setItems((list) => list.filter((d) => d.id !== draft.id))} className="mt-2 rounded-full p-1 text-zinc-400 hover:bg-zinc-900">
                  <X size={18} />
                </button>
              )}
            </div>

            {draft.images.length > 0 && (
              <ul className="mb-2 grid grid-cols-2 gap-2" aria-label="Attached images">
                {draft.images.map((image) => (
                  <li key={image.id} className="relative overflow-hidden rounded-xl border border-zinc-800">
                    {image.video
                      ? <video src={image.previewUrl} muted preload="metadata" aria-label="Selected video preview" className="h-32 w-full bg-black object-cover" />
                      : <img src={image.previewUrl} alt="Selected image preview" className="h-32 w-full object-cover" />}
                    {image.status === 'uploading' && (
                      <div role="progressbar" aria-label={image.video ? 'Uploading video' : 'Uploading image'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(image.progress * 100)} className="absolute inset-x-0 bottom-0 h-1 bg-zinc-800">
                        <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(image.progress, 0.05) * 100}%` }} />
                      </div>
                    )}
                    {image.status === 'error' && <p role="alert" className="absolute inset-x-0 bottom-0 bg-red-600/90 px-2 py-1 text-xs">{image.error}</p>}
                    <button type="button" aria-label={image.video ? 'Remove video' : 'Remove image'} onClick={() => removeImage(draft, image)} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 hover:bg-black">
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {index === 0 && poll && (
              <fieldset className="mb-2 space-y-2 rounded-xl border border-zinc-800 p-3">
                <legend className="px-1 text-sm font-semibold text-zinc-300">Poll</legend>
                {poll.options.map((option, i) => (
                  <input
                    key={i}
                    aria-label={`Poll option ${i + 1}`}
                    placeholder={`Option ${i + 1}`}
                    maxLength={MAX_POLL_OPTION_LENGTH}
                    value={option}
                    onChange={(e) => setPoll({ ...poll, options: poll.options.map((o, j) => (j === i ? e.target.value : o)) })}
                    className="w-full rounded-md border border-zinc-700 bg-black px-3 py-2 placeholder:text-zinc-600 focus:border-brand focus:outline-none"
                  />
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={poll.options.length >= MAX_POLL_OPTIONS}
                    onClick={() => setPoll({ ...poll, options: [...poll.options, ''] })}
                    className="flex items-center gap-1 text-sm font-semibold text-brand hover:underline disabled:opacity-40"
                  >
                    <Plus size={14} aria-hidden="true" /> Add option
                  </button>
                  <label className="flex items-center gap-2 text-sm text-zinc-400">
                    Poll length
                    <select
                      value={poll.minutes}
                      onChange={(e) => setPoll({ ...poll, minutes: Number(e.target.value) })}
                      className="rounded-full border border-zinc-700 bg-black px-2 py-1 text-brand"
                    >
                      {POLL_DURATIONS.map((d) => <option key={d.minutes} value={d.minutes}>{d.label}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={() => setPoll(null)} className="text-sm font-semibold text-red-400 hover:underline">Remove poll</button>
                </div>
              </fieldset>
            )}

            {index === 0 && quoting && (
              <div className="mb-2 rounded-2xl border border-zinc-800 p-3" role="group" aria-label={`Quoting ${quoting.author.displayName}`}>
                <PostHeader author={quoting.author} createdAt={quoting.createdAt} />
                <PostText content={quoting.content} mentions={quoting.mentions} className="line-clamp-4 text-[15px]" />
                <PostMedia urls={quoting.mediaUrls.slice(0, 1)} />
              </div>
            )}

            <div className="flex items-center gap-2 border-t border-zinc-800 pt-2">
              <input
                ref={(node) => { if (node) fileInputs.current.set(draft.id, node); else fileInputs.current.delete(draft.id) }}
                type="file"
                hidden
                multiple
                accept={[...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].join(',')}
                aria-label={`Choose images${isThread ? ` for post ${index + 1}` : ''}`}
                onChange={(e) => addImages(draft, e)}
              />
              <button
                type="button"
                aria-label="Add images"
                title="Add images or a video"
                disabled={draft.images.length >= MAX_IMAGES_PER_POST || draft.images.some((i) => i.video) || (index === 0 && poll !== null)}
                onClick={() => fileInputs.current.get(draft.id)?.click()}
                className="rounded-full p-2 text-brand hover:bg-brand/10 disabled:opacity-40"
              >
                <ImagePlus size={20} />
              </button>
              {index === 0 && isTopLevel && (
                <button
                  type="button"
                  aria-label="Add poll"
                  title="Add poll"
                  disabled={!pollAllowed || poll !== null}
                  onClick={() => setPoll(newPoll())}
                  className="rounded-full p-2 text-brand hover:bg-brand/10 disabled:opacity-40"
                >
                  <ChartNoAxesColumn size={20} />
                </button>
              )}
              <Counter length={draft.text.length} />
            </div>
          </div>
        </div>
      ))}

      {isTopLevel && poll === null && items.length < MAX_THREAD_POSTS && (
        <button type="button" onClick={() => setItems((list) => [...list, newDraft()])} className="mb-3 ml-[52px] flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
          <Plus size={16} /> Add another post
        </button>
      )}

      {error && <p role="alert" className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {isTopLevel ? (
          <>
            <label htmlFor={policyId} className="sr-only">Who can reply</label>
            <select id={policyId} value={policy} onChange={(e) => setPolicy(e.target.value as ReplyPolicy)} className="rounded-full border border-zinc-700 bg-black px-3 py-1.5 text-sm text-brand">
              {(Object.keys(policyLabels) as ReplyPolicy[]).map((p) => <option key={p} value={p}>{policyLabels[p]}</option>)}
            </select>
          </>
        ) : <span />}
        <Button onClick={() => void submit()} disabled={!canSubmit} loading={submitting}>
          {isThread ? 'Post all' : submitLabel}
        </Button>
      </div>
    </div>
  )
}

function Counter({ length }: { length: number }) {
  const left = MAX_POST_LENGTH - length
  if (length === 0) return null
  return (
    <span aria-label={left >= 0 ? `${left} characters left` : `${-left} characters over the limit`} className={`ml-auto text-sm ${left < 0 ? 'font-bold text-red-500' : left <= 20 ? 'text-amber-400' : 'text-zinc-500'}`}>
      {left}
    </span>
  )
}
