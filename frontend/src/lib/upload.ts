import { ApiError, api } from './api'
import type { UploadUrlResponse } from './types'

// Same limits as the backend (MediaService). The server stays the authority; these only avoid pointless uploads.
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGES_PER_POST = 4
export const MAX_IMAGES_PER_MESSAGE = 4

/** Returns a message when the file cannot be uploaded, otherwise null. */
export function validateImage(file: Pick<File, 'type' | 'size' | 'name'>): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return `${file.name}: use a JPEG, PNG, WebP or GIF image.`
  if (file.size > MAX_IMAGE_BYTES) return `${file.name}: images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`
  if (file.size === 0) return `${file.name} is empty.`
  return null
}

// A browser sets these itself and refuses to let a script set them.
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'user-agent', 'accept-encoding'])

function put(url: string, file: File, headers: Record<string, string[]>, onProgress: (fraction: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [name, values] of Object.entries(headers)) {
      if (!FORBIDDEN_HEADERS.has(name.toLowerCase())) xhr.setRequestHeader(name, values.join(','))
    }
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, 'The image could not be uploaded. Please try again.')))
    xhr.onerror = () => reject(new ApiError(0, 'The image could not be uploaded. Check your connection and try again.'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(file)
  })
}

export interface UploadedImage {
  /** Pass as a media key when creating the post. */
  key: string
  publicUrl: string
}

/**
 * Two steps, as the backend expects: ask for a presigned URL, then send the bytes straight to storage (R2). The server
 * only accepts keys under the caller's own prefix that actually exist in the bucket.
 */
export async function uploadImage(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<UploadedImage> {
  let target: UploadUrlResponse
  try {
    target = await api.post<UploadUrlResponse>('/api/media/upload-url', { contentType: file.type, contentLength: file.size }, { signal })
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) throw new ApiError(503, 'Image uploads are not set up on this server yet.')
    throw e
  }
  await put(target.uploadUrl, file, target.headers, onProgress, signal)
  onProgress(1)
  return { key: target.key, publicUrl: target.publicUrl }
}
