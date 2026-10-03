import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  api,
  configureApi,
  pageUrl,
  setRateLimitHandler,
  setSessionExpiredHandler,
} from './api'
import { tokens } from './tokens'

const BASE = 'http://api.test'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => {
  server.resetHandlers()
  setSessionExpiredHandler(undefined)
  setRateLimitHandler(undefined)
})

function tokenResponse(access: string, refresh: string) {
  return HttpResponse.json({ accessToken: access, refreshToken: refresh, expiresIn: 60, user: {} })
}

describe('api client', () => {
  it('sends the bearer token, parses JSON and treats 204 as undefined', async () => {
    tokens.set('access-1', 'refresh-1')
    let seen: string | null = null
    server.use(
      http.get(`${BASE}/api/thing`, ({ request }) => {
        seen = request.headers.get('Authorization')
        return HttpResponse.json({ ok: true })
      }),
      http.delete(`${BASE}/api/thing`, () => new HttpResponse(null, { status: 204 })),
    )

    expect(await api.get<{ ok: boolean }>('/api/thing')).toEqual({ ok: true })
    expect(seen).toBe('Bearer access-1')
    expect(await api.delete('/api/thing')).toBeUndefined()
  })

  it('turns problem JSON into an ApiError with field errors', async () => {
    server.use(
      http.post(`${BASE}/api/auth/register`, () =>
        HttpResponse.json(
          { title: 'Bad Request', status: 400, detail: 'Validation failed', errors: { username: 'is taken' } },
          { status: 400 },
        ),
      ),
    )

    const error = await api.post('/api/auth/register', {}, { auth: false }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, message: 'Validation failed', fieldErrors: { username: 'is taken' } })
  })

  it('refreshes once on a 401 and retries with the rotated token', async () => {
    tokens.set('stale', 'refresh-1')
    const used: Array<string | null> = []
    server.use(
      http.get(`${BASE}/api/me`, ({ request }) => {
        const auth = request.headers.get('Authorization')
        used.push(auth)
        return auth === 'Bearer fresh' ? HttpResponse.json({ id: 1 }) : new HttpResponse(null, { status: 401 })
      }),
      http.post(`${BASE}/api/auth/refresh`, async ({ request }) => {
        expect(await request.json()).toEqual({ refreshToken: 'refresh-1' })
        return tokenResponse('fresh', 'refresh-2')
      }),
    )

    expect(await api.get('/api/me')).toEqual({ id: 1 })
    expect(used).toEqual(['Bearer stale', 'Bearer fresh'])
    expect(tokens.getAccess()).toBe('fresh')
    expect(tokens.getRefresh()).toBe('refresh-2')
  })

  it('shares ONE refresh between concurrent requests (the backend revokes sessions on token reuse)', async () => {
    tokens.set('stale', 'refresh-1')
    const refresh = vi.fn()
    server.use(
      http.get(`${BASE}/api/me`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer fresh'
          ? HttpResponse.json({ ok: true })
          : new HttpResponse(null, { status: 401 }),
      ),
      http.post(`${BASE}/api/auth/refresh`, async () => {
        refresh()
        await new Promise((r) => setTimeout(r, 30))
        return tokenResponse('fresh', 'refresh-2')
      }),
    )

    const results = await Promise.all(Array.from({ length: 6 }, () => api.get('/api/me')))

    expect(results).toHaveLength(6)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('gets an access token before the first call after a page reload (only the refresh token survives)', async () => {
    localStorage.setItem('xclone.refreshToken', 'refresh-1')
    const refresh = vi.fn()
    server.use(
      http.post(`${BASE}/api/auth/refresh`, () => {
        refresh()
        return tokenResponse('fresh', 'refresh-2')
      }),
      http.get(`${BASE}/api/me`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer fresh'
          ? HttpResponse.json({ ok: true })
          : new HttpResponse(null, { status: 401 }),
      ),
    )

    expect(await api.get('/api/me')).toEqual({ ok: true })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not send the request at all when the refresh needed before it is rejected', async () => {
    localStorage.setItem('xclone.refreshToken', 'revoked')
    const sent = vi.fn()
    server.use(
      http.post(`${BASE}/api/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
      http.get(`${BASE}/api/me`, () => {
        sent()
        return HttpResponse.json({})
      }),
    )

    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401 })

    expect(sent).not.toHaveBeenCalled()
  })

  it('signs out when the refresh token is rejected', async () => {
    tokens.set('stale', 'refresh-1')
    const expired = vi.fn()
    setSessionExpiredHandler(expired)
    server.use(
      http.get(`${BASE}/api/me`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${BASE}/api/auth/refresh`, () => new HttpResponse(null, { status: 401 })),
    )

    await expect(api.get('/api/me')).rejects.toMatchObject({ status: 401 })

    expect(expired).toHaveBeenCalledTimes(1)
    expect(tokens.getAccess()).toBeNull()
    expect(tokens.getRefresh()).toBeNull()
  })

  it('keeps the session when the refresh fails only because the network is down', async () => {
    tokens.set('stale', 'refresh-1')
    const expired = vi.fn()
    setSessionExpiredHandler(expired)
    server.use(
      http.get(`${BASE}/api/me`, () => new HttpResponse(null, { status: 401 })),
      http.post(`${BASE}/api/auth/refresh`, () => HttpResponse.error()),
    )

    await expect(api.get('/api/me')).rejects.toBeInstanceOf(ApiError)

    expect(expired).not.toHaveBeenCalled()
    expect(tokens.getRefresh()).toBe('refresh-1')
  })

  it('does not try to refresh when auth is off (a 401 on login means wrong credentials)', async () => {
    tokens.set('access', 'refresh-1')
    const refresh = vi.fn()
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ title: 'Unauthorized', status: 401, detail: 'Invalid credentials' }, { status: 401 }),
      ),
      http.post(`${BASE}/api/auth/refresh`, () => {
        refresh()
        return tokenResponse('x', 'y')
      }),
    )

    await expect(api.post('/api/auth/login', {}, { auth: false })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials',
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('reports 429 with the Retry-After seconds', async () => {
    const limited = vi.fn()
    setRateLimitHandler(limited)
    server.use(
      http.post(`${BASE}/api/posts`, () =>
        HttpResponse.json({ title: 'Too Many Requests', status: 429 }, { status: 429, headers: { 'Retry-After': '42' } }),
      ),
    )

    await expect(api.post('/api/posts', { content: 'hi' })).rejects.toMatchObject({ status: 429, retryAfter: 42 })
    expect(limited).toHaveBeenCalledWith(42)
  })

  it('wraps network failures in a friendly ApiError', async () => {
    server.use(http.get(`${BASE}/api/down`, () => HttpResponse.error()))
    await expect(api.get('/api/down')).rejects.toMatchObject({ status: 0 })
  })
})

describe('pageUrl', () => {
  it('adds cursor and limit, keeping existing query parameters', () => {
    expect(pageUrl('/api/timeline')).toBe('/api/timeline?limit=20')
    expect(pageUrl('/api/timeline', 55, 10)).toBe('/api/timeline?cursor=55&limit=10')
    expect(pageUrl('/api/posts/search', null, 20, { q: 'a b' })).toBe('/api/posts/search?q=a+b&limit=20')
  })
})
