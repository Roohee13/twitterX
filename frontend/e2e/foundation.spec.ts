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

  test('a returning user is restored after a reload, and the refresh token rotates', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user)

    await expect(page.getByText(user.displayName).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    await page.screenshot(shot('foundation-shell-desktop'))

    const before = await page.evaluate(() => localStorage.getItem('xclone.refreshToken'))
    await page.reload()
    await expect(page.getByText(user.displayName).first()).toBeVisible()
    const after = await page.evaluate(() => localStorage.getItem('xclone.refreshToken'))
    expect(after).not.toBeNull()
    expect(after).not.toBe(before) // restoring the session spent the old refresh token and stored the new one
  })

  test('two tabs restoring the same session at once do not get it revoked', async ({ browser, request }) => {
    const user = await createUser(request)
    const context = await browser.newContext()
    const first = await context.newPage()
    await signIn(first, user)
    await expect(first.getByText(user.displayName).first()).toBeVisible()
    const second = await context.newPage()
    await second.goto('/')

    // Both tabs reload at the same moment: both need a refresh, and a reused token would revoke everything.
    await Promise.all([first.reload(), second.reload()])

    await expect(first.getByText(user.displayName).first()).toBeVisible()
    await expect(second.getByText(user.displayName).first()).toBeVisible()
    await expect(first).toHaveURL(/\/$/)
    await expect(second).toHaveURL(/\/$/)
    await context.close()
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
    const tag = `e2etag${Date.now().toString(36)}`
    await request.post('/api/posts', { data: { content: `hello #${tag}` }, headers: { Authorization: `Bearer ${user.accessToken}` } })

    await signIn(page, user)

    await expect(page.getByRole('region', { name: 'Trends' }).getByText(`#${tag}`)).toBeVisible()
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
