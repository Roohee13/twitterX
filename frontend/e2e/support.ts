import type { APIRequestContext, Page } from '@playwright/test'

export interface TestUser {
  username: string
  email: string
  password: string
  displayName: string
  accessToken: string
  refreshToken: string
  id: number
}

let counter = 0

export function uniqueName(prefix = 'e2e') {
  counter += 1
  return `${prefix}${Date.now().toString(36).slice(-6)}${counter}`.slice(0, 15)
}

/** Registers a user through the API (the fast way to get an account for tests that are not about registration). */
export async function createUser(request: APIRequestContext, overrides: Partial<{ username: string; displayName: string }> = {}): Promise<TestUser> {
  const username = overrides.username ?? uniqueName()
  const body = { username, email: `${username}@example.com`, password: 'password123', displayName: overrides.displayName ?? `Tester ${username}` }
  const res = await request.post('/api/auth/register', { data: body })
  if (!res.ok()) throw new Error(`register failed: ${res.status()} ${await res.text()}`)
  const data = await res.json()
  return { ...body, accessToken: data.accessToken, refreshToken: data.refreshToken, id: data.user.id }
}

/**
 * Signs the browser in by storing the refresh token once, the way a previous visit would have left it. It must not be an
 * init script: that would re-store the (already rotated, now reused) token on every navigation and the backend would
 * treat it as theft and revoke the session.
 */
export async function signIn(page: Page, user: Pick<TestUser, 'refreshToken'>, path = '/') {
  await page.goto('/__blank') // any page on the origin, without triggering the session restore for a real route
  await page.evaluate((token) => localStorage.setItem('xclone.refreshToken', token), user.refreshToken)
  await page.goto(path)
}

export const shot = (name: string) => ({ path: `e2e/screenshots/${name}.png`, fullPage: false })

/**
 * The backend only logs emails when no SMTP server is configured, so the tests read the link from its log
 * (scripts/e2e-backend.sh writes it to e2e/backend.log). Returns the app path with the token, e.g. `/verify-email?token=...`.
 * Waits for the newest matching line, so a resend is picked up instead of the earlier email.
 */
export async function emailedLink(email: string, kind: 'verify-email' | 'reset-password', previous?: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const logPath = `${process.cwd()}/e2e/backend.log`
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const text = await readFile(logPath, 'utf8').catch(() => '')
    const matches = [...text.matchAll(new RegExp(`To: ${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|[^\\n]*?(/${kind}\\?token=[\\w-]+)`, 'g'))]
    const latest = matches.at(-1)?.[1]
    if (latest && latest !== previous) return latest
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`No ${kind} email for ${email} found in ${logPath}. Was the backend started with scripts/e2e-backend.sh?`)
}
