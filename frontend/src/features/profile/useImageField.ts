import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import { uploadImage, validateImage } from '../../lib/upload'

export interface ImageField {
  status: 'unchanged' | 'uploading' | 'ready' | 'removed' | 'error'
  /** What to show right now: the current picture, the newly chosen one, or nothing after a removal. */
  previewUrl: string | null
  progress: number
  error?: string
  /** The value to send to the server: a new key, "" to clear the picture, or undefined to leave it alone. */
  value: string | undefined
  choose: (file: File) => void
  remove: () => void
}

/** One picture the user can replace or remove (avatar or banner). A chosen file is uploaded right away; the key is sent on save. */
export function useImageField(currentUrl: string | null): ImageField {
  const [state, setState] = useState<Omit<ImageField, 'choose' | 'remove' | 'value'> & { key?: string }>({ status: 'unchanged', previewUrl: currentUrl, progress: 0 })
  const abort = useRef<AbortController | null>(null)
  const objectUrl = useRef<string | null>(null)

  const release = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = null
  }, [])
  useEffect(() => release, [release])

  const choose = useCallback(
    (file: File) => {
      const problem = validateImage(file)
      if (problem) {
        setState((s) => ({ ...s, status: s.status === 'uploading' ? 'unchanged' : s.status, error: problem }))
        return
      }
      release()
      const controller = new AbortController()
      abort.current = controller
      objectUrl.current = URL.createObjectURL(file)
      setState({ status: 'uploading', previewUrl: objectUrl.current, progress: 0 })
      uploadImage(file, (progress) => setState((s) => (s.status === 'uploading' ? { ...s, progress } : s)), controller.signal)
        .then(({ key }) => setState((s) => ({ ...s, status: 'ready', key, progress: 1, error: undefined })))
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === 'AbortError') return
          setState({ status: 'error', previewUrl: currentUrl, progress: 0, error: e instanceof ApiError ? e.message : 'Upload failed.' })
        })
    },
    [currentUrl, release],
  )

  const remove = useCallback(() => {
    release()
    setState({ status: 'removed', previewUrl: null, progress: 0 })
  }, [release])

  const value = state.status === 'ready' ? state.key : state.status === 'removed' ? '' : undefined
  return { status: state.status, previewUrl: state.previewUrl, progress: state.progress, error: state.error, value, choose, remove }
}
