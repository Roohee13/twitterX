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
