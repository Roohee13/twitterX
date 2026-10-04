import { expect, test } from '@playwright/test'
import { createUser, shot, signIn } from './support'

test.describe('app foundation', () => {
  test('a signed-out visitor is sent to the login page', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  })

  test('unknown pages show a not-found screen', async ({ page }) => {
    await page.goto('/nowhere')
    await expect(page.getByRole('heading', { name: "This page doesn't exist" })).toBeVisible()
  })

  test('a returning user is restored after a reload; a reload spends no refresh token, a new tab does and the token rotates', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user)

    await expect(page.getByText(user.displayName).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    await page.screenshot(shot('foundation-shell-desktop'))

    const before = await page.evaluate(() => localStorage.getItem('xclone.refreshToken'))
    await page.reload()
    await expect(page.getByText(user.displayName).first()).toBeVisible()
    // The tab still had a usable access token, so nothing had to be refreshed.
    expect(await page.evaluate(() => localStorage.getItem('xclone.refreshToken'))).toBe(before)

    // A new tab starts without one (sessionStorage is per tab): restoring the session spends the old refresh token and stores the new one.
    await page.evaluate(() => sessionStorage.clear())
    await page.reload()
    await expect(page.getByText(user.displayName).first()).toBeVisible()
    const after = await page.evaluate(() => localStorage.getItem('xclone.refreshToken'))
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
  })

  test('two tabs restoring the same session at once do not get it revoked', async ({ browser, request }) => {
    const user = await createUser(request)
    const context = await browser.newContext()
    const first = await context.newPage()
    await signIn(first, user)
    await expect(first.getByText(user.displayName).first()).toBeVisible()
    const second = await context.newPage()
    await second.goto('/')
    await expect(second.getByText(user.displayName).first()).toBeVisible() // its own restore is finished, so nothing is cut off mid-flight below

    // Both tabs reload at the same moment: both need a refresh, and a reused token would revoke everything.
    await Promise.all([first.reload(), second.reload()])

    await expect(first.getByText(user.displayName).first()).toBeVisible()
    await expect(second.getByText(user.displayName).first()).toBeVisible()
    await expect(first).toHaveURL(/\/$/)
    await expect(second).toHaveURL(/\/$/)
    await context.close()
  })

  test('reloading again right away does not sign the user out of every device', async ({ page, request }) => {
    // Each page load used to spend the refresh token. Reloading a second time before the first load had stored the new one made the
    // backend see a used token, treat it as stolen and revoke all sessions. Now a reload keeps using the access token it already has.
    const user = await createUser(request)
    await signIn(page, user)
    await expect(page.getByText(user.displayName).first()).toBeVisible()
    for (let i = 0; i < 40; i++) {
      await page.reload({ waitUntil: 'commit' })
      await page.waitForTimeout(5 + (i % 12) * 5) // a different gap each time, from 5 to 60 ms
      await page.reload({ waitUntil: 'commit' })
      await page.waitForTimeout(250)
      expect(page.url(), `signed out after reload pair ${i + 1}`).not.toContain('/login')
    }
    await expect(page.getByText(user.displayName).first()).toBeVisible()
    // And the session really is intact on the server: the original refresh token chain still works from a second browser tab.
    const second = await page.context().newPage()
    await second.goto('/')
    await expect(second.getByText(user.displayName).first()).toBeVisible()
  })

  test('logging out ends the session on the server too', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user)
    const token = await page.evaluate(() => localStorage.getItem('xclone.refreshToken'))

    await page.getByRole('button', { name: 'Log out' }).click()

    await expect(page).toHaveURL(/\/login$/)
    expect(await page.evaluate(() => localStorage.getItem('xclone.refreshToken'))).toBeNull()
    const reuse = await request.post('/api/auth/refresh', { data: { refreshToken: token } })
    expect(reuse.status()).toBe(401)
  })

  test('an invalid stored session sends the visitor to login', async ({ page }) => {
    await signIn(page, { refreshToken: 'not-a-real-token' })
    await expect(page).toHaveURL(/\/login$/)
  })

  test('a signed-in user visiting /login goes home', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user, '/login')
    await expect(page).toHaveURL(/\/$/)
  })

  test('the trends panel shows live data from the backend', async ({ page, request }) => {
    const user = await createUser(request)
    // Which tags make the short list depends on all the test data in the shared database, so only check that real trends arrive
    // and link to their hashtag pages (a specific tag is checked in discovery.spec.ts with a controlled list).
    for (const author of [user, await createUser(request), await createUser(request)]) {
      await request.post('/api/posts', { data: { content: `hello #e2etag${Date.now().toString(36)}` }, headers: { Authorization: `Bearer ${author.accessToken}` } })
    }

    await signIn(page, user)

    const first = page.getByRole('region', { name: 'Trends' }).getByRole('link').first()
    await expect(first).toBeVisible()
    await expect(first).toHaveAttribute('href', /^\/hashtag\/.+/)
  })

  test('on a phone the navigation moves to the bottom bar', async ({ browser, request }) => {
    const user = await createUser(request)
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true })
    const page = await context.newPage()
    await signIn(page, user)

    await expect(page.getByRole('navigation', { name: 'Main (mobile)' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeHidden()
    await page.screenshot(shot('foundation-shell-mobile'))
    await context.close()
  })
})
