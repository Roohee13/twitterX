// Two tokens, kept differently on purpose.
//
// The refresh token must survive closing the browser, so it is in localStorage. It is spent whenever it is used (the backend rotates it,
// and treats a token shown twice as stolen: it revokes every session), so it should be used as rarely as possible.
//
// The access token is short-lived. It is kept in memory and also in sessionStorage (this tab only, gone when the tab closes), so a page
// reload can keep using it instead of spending the refresh token. Without that, reloading twice within a few milliseconds could cut a
// refresh off after the server had already rotated the token, and the next page load would look like theft and sign the user out everywhere.
// Both values are readable by any script on the page (as the refresh token always was), so the app must never render untrusted HTML.
const REFRESH_KEY = 'xclone.refreshToken'
const ACCESS_KEY = 'xclone.accessToken'
/** Stop using an access token this long before it expires, so a request does not set off with one that dies on the way. */
const SAFETY_MARGIN_MS = 30_000

let accessToken: string | null = null

/** The `exp` claim of a JWT in milliseconds, or null when the token cannot be read. */
function expiryOf(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown }
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null
  } catch {
    return null
  }
}

/** Has time left. A token whose expiry cannot be read is judged by the server instead (a 401 triggers a refresh). */
function hasTimeLeft(token: string): boolean {
  const expiry = expiryOf(token)
  return expiry === null || expiry - SAFETY_MARGIN_MS > Date.now()
}

function readSession(): string | null {
  try {
    return sessionStorage.getItem(ACCESS_KEY)
  } catch {
    return null
  }
}

export const tokens = {
  /** The access token, if there is one that still has time left (also after a reload of this tab). */
  getAccess(): string | null {
    if (accessToken && hasTimeLeft(accessToken)) return accessToken
    accessToken = null
    const stored = readSession()
    // Only a token that is readable AND has time left comes back after a reload; anything odd in storage is ignored.
    if (stored && expiryOf(stored) !== null && hasTimeLeft(stored)) {
      accessToken = stored
      return stored
    }
    return null
  },
  getRefresh(): string | null {
    try {
      return localStorage.getItem(REFRESH_KEY)
    } catch {
      return null
    }
  },
  set(access: string, refresh: string) {
    accessToken = access
    try {
      sessionStorage.setItem(ACCESS_KEY, access)
    } catch {
      /* storage unavailable: a reload will refresh instead */
    }
    try {
      localStorage.setItem(REFRESH_KEY, refresh)
    } catch {
      /* storage unavailable: the session just will not survive a reload */
    }
  },
  clear() {
    accessToken = null
    try {
      sessionStorage.removeItem(ACCESS_KEY)
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(REFRESH_KEY)
    } catch {
      /* ignore */
    }
  },
}
