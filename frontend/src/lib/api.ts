import { tokens } from './tokens'
import type { AuthResponse, Problem } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors: Record<string, string>
  /** Seconds to wait, from the Retry-After header of a 429. */
  readonly retryAfter?: number

  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}, retryAfter?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
    this.retryAfter = retryAfter
  }
}

let baseUrl: string = import.meta.env.VITE_API_BASE ?? ''
let onSessionExpired: (() => void) | undefined
let onRateLimited: ((retryAfterSeconds: number) => void) | undefined

/** `baseUrl` is empty in development (the Vite proxy serves /api) and the API origin in production. */
export function configureApi(options: { baseUrl?: string }) {
  if (options.baseUrl !== undefined) baseUrl = options.baseUrl
}

export function setSessionExpiredHandler(handler: (() => void) | undefined) {
  onSessionExpired = handler
}

export function setRateLimitHandler(handler: ((retryAfterSeconds: number) => void) | undefined) {
  onRateLimited = handler
}

interface RequestOptions {
  method?: string
  body?: unknown
  /** Default true. Login, register and the like pass false so a 401 means "wrong credentials", not "refresh and retry". */
  auth?: boolean
  signal?: AbortSignal
}

async function toError(res: Response): Promise<ApiError> {
  let problem: Problem = {}
  try {
    problem = (await res.json()) as Problem
  } catch {
    /* not JSON */
  }
  const retryAfter = Number(res.headers.get('Retry-After')) || undefined
  const message = problem.detail ?? problem.title ?? `Request failed (${res.status})`
  return new ApiError(res.status, message, problem.errors ?? {}, retryAfter)
}

// --- Refresh ---------------------------------------------------------------------------------------------------
// The backend rotates refresh tokens and treats a reused one as theft (it revokes every session). So refreshes must
// never overlap: concurrent requests in this tab share one refresh, and the Web Locks API serializes tabs (each tab
// re-reads the latest refresh token from localStorage once it holds the lock).

let refreshInFlight: Promise<void> | null = null

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? locks.request('xclone-refresh', fn) : fn()
}

async function doRefresh(): Promise<void> {
  await withRefreshLock(async () => {
    const refreshToken = tokens.getRefresh()
    if (!refreshToken) throw new ApiError(401, 'Not signed in')
    let res: Response
    try {
      res = await fetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
    } catch {
      throw new ApiError(0, 'Network error') // keep the session: the server may just be unreachable
    }
    if (res.ok) {
      const data = (await res.json()) as AuthResponse
      tokens.set(data.accessToken, data.refreshToken)
      return
    }
    if (res.status === 400 || res.status === 401) {
      tokens.clear()
      onSessionExpired?.()
    }
    throw await toError(res)
  })
}

/** Refreshes the access token; callers racing each other all wait for the same single refresh. */
export function refreshSession(): Promise<void> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

// --- Requests --------------------------------------------------------------------------------------------------

async function send(path: string, options: RequestOptions, auth: boolean): Promise<Response> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const access = tokens.getAccess()
  if (auth && access) headers.Authorization = `Bearer ${access}`
  try {
    return await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }
}

async function request<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const auth = options.auth !== false
  // After a page reload only the refresh token survives, so get an access token before the first call.
  // If that refresh fails the call fails with the refresh error instead of going out without credentials.
  if (auth && !tokens.getAccess() && tokens.getRefresh()) {
    await refreshSession()
  }
  const res = await send(path, options, auth)
  if (res.status === 401 && auth && !retried && tokens.getRefresh()) {
    try {
      await refreshSession()
    } catch {
      throw await toError(res)
    }
    return request<T>(path, options, true)
  }
  if (res.status === 429) {
    const error = await toError(res)
    if (error.retryAfter) onRateLimited?.(error.retryAfter)
    throw error
  }
  if (!res.ok) throw await toError(res)
  if (res.status === 204) return undefined as T
  const type = res.headers.get('Content-Type') ?? ''
  return (type.includes('json') ? await res.json() : await res.text()) as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, options),
  post: <T = void>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T = void>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
}

/** Adds `?cursor=&limit=` for the API's cursor pagination. */
export function pageUrl(path: string, cursor?: number | null, limit = 20, extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra)
  if (cursor != null) params.set('cursor', String(cursor))
  params.set('limit', String(limit))
  return `${path}${path.includes('?') ? '&' : '?'}${params}`
}
