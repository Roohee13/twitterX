// The access token lives in memory only. The refresh token must survive reloads, so it is kept in localStorage
// (readable by any script on the page, so the app must never render untrusted HTML).
const REFRESH_KEY = 'xclone.refreshToken'

let accessToken: string | null = null

export const tokens = {
  getAccess: () => accessToken,
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
      localStorage.setItem(REFRESH_KEY, refresh)
    } catch {
      /* storage unavailable: the session just will not survive a reload */
    }
  },
  clear() {
    accessToken = null
    try {
      localStorage.removeItem(REFRESH_KEY)
    } catch {
      /* ignore */
    }
  },
}
