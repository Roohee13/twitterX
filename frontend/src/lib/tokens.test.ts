import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A JWT-shaped token that expires `seconds` from now (the signature is irrelevant to the client). */
function jwt(seconds: number) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256' })}.${b64({ sub: '1', exp: Math.floor(Date.now() / 1000) + seconds })}.signature`
}

/** A fresh copy of the module, like the page loading again: its in-memory state is gone, the browser's storage is not. */
async function reloadedTokens() {
  vi.resetModules()
  return (await import('./tokens')).tokens
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(() => vi.useRealTimers())

describe('tokens across a page reload', () => {
  it('a reload keeps using the access token while it has time left, so the refresh token is not spent', async () => {
    const first = await reloadedTokens()
    const access = jwt(15 * 60)
    first.set(access, 'refresh-1')

    const afterReload = await reloadedTokens()

    expect(afterReload.getAccess()).toBe(access)
    expect(afterReload.getRefresh()).toBe('refresh-1')
  })

  it('an access token that is about to expire (or has) is not used again after a reload', async () => {
    const first = await reloadedTokens()
    first.set(jwt(10), 'refresh-1') // inside the 30 second safety margin
    expect((await reloadedTokens()).getAccess()).toBeNull()

    first.set(jwt(-60), 'refresh-1')
    expect((await reloadedTokens()).getAccess()).toBeNull()
    // The refresh token is untouched: the next request refreshes with it.
    expect((await reloadedTokens()).getRefresh()).toBe('refresh-1')
  })

  it('stops handing out a token as it runs out, within the same page too', async () => {
    vi.useFakeTimers()
    const tokens = await reloadedTokens()
    tokens.set(jwt(120), 'refresh-1')
    expect(tokens.getAccess()).not.toBeNull()

    vi.advanceTimersByTime(100_000) // 20 seconds left: inside the margin

    expect(tokens.getAccess()).toBeNull()
  })

  it('ignores junk in storage', async () => {
    sessionStorage.setItem('xclone.accessToken', 'not-a-jwt')
    expect((await reloadedTokens()).getAccess()).toBeNull()
    sessionStorage.setItem('xclone.accessToken', 'a.b.c')
    expect((await reloadedTokens()).getAccess()).toBeNull()
  })

  it('a token whose expiry cannot be read still works in memory (the server decides), but is not restored after a reload', async () => {
    const first = await reloadedTokens()
    first.set('opaque-token', 'refresh-1')
    expect(first.getAccess()).toBe('opaque-token')
    expect((await reloadedTokens()).getAccess()).toBeNull()
  })

  it('clear forgets both tokens everywhere', async () => {
    const first = await reloadedTokens()
    first.set(jwt(900), 'refresh-1')

    first.clear()

    expect(first.getAccess()).toBeNull()
    expect(first.getRefresh()).toBeNull()
    expect(sessionStorage.getItem('xclone.accessToken')).toBeNull()
    expect((await reloadedTokens()).getAccess()).toBeNull()
  })

  it('works when storage is blocked: nothing is remembered, nothing throws', async () => {
    const blocked = () => {
      throw new DOMException('blocked', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked)
    const tokens = await reloadedTokens()

    expect(() => tokens.set(jwt(900), 'refresh-1')).not.toThrow()
    expect(tokens.getAccess()).not.toBeNull() // still in memory for this page
    expect(tokens.getRefresh()).toBeNull()
    expect(() => tokens.clear()).not.toThrow()
    vi.restoreAllMocks()
  })
})
