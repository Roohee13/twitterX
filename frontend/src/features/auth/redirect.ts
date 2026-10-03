/**
 * Where to go after signing in: the page the visitor was sent away from, but only if it is a path inside this app.
 * Anything else (another site, `//host`, `/\host`, non-strings) falls back to the home page, so a crafted login link
 * cannot bounce someone to a malicious site after they enter their password.
 */
export function safeRedirect(from: unknown): string {
  if (typeof from !== 'string') return '/'
  if (!from.startsWith('/') || from.startsWith('//') || from.includes('\\') || from.includes('://')) return '/'
  if (from === '/login' || from === '/register') return '/'
  return from
}
