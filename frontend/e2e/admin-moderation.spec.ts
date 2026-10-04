import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { as, createUser, setAdmin, shot, signIn, type TestUser } from './support'

const row = (page: Page, name: string | RegExp) => page.getByRole('article', { name })

async function notifications(request: APIRequestContext, user: TestUser) {
  const res = await request.get('/api/notifications', { headers: { Authorization: `Bearer ${user.accessToken}` } })
  expect(res.ok()).toBe(true)
  return (await res.json()).items as Array<{ type: string; detail: string | null; actor: unknown }>
}

const loginStatus = async (request: APIRequestContext, user: TestUser) =>
  (await request.post('/api/auth/login', { data: { usernameOrEmail: user.username, password: user.password } })).status()

async function scene(request: APIRequestContext) {
  const admin = await createUser(request, { displayName: 'Ada Admin' })
  await setAdmin(admin.username)
  const bad = await createUser(request, { displayName: 'Bad Actor' })
  const reporter = await createUser(request, { displayName: 'Rita Reporter' })
  return { admin, bad, reporter }
}

test.describe('moderation notifications', () => {
  test('a report alerts the admin, removing the post tells the author, and the reporter hears the outcome', async ({ page, request }) => {
    const { admin, bad, reporter } = await scene(request)
    const post = await as(request, bad).post('moderation notice test post')

    await as(request, reporter).reportPost(post.id, 'HARASSMENT')
    const alert = (await notifications(request, admin)).find((n) => n.type === 'REPORT_RECEIVED' && n.detail?.includes(`@${bad.username}`))
    expect(alert).toBeTruthy()
    expect(alert!.actor).toBeNull() // nobody's name is on a system alert

    await signIn(page, admin, '/admin/reports?tab=posts')
    await row(page, `Report on a post by @${bad.username}`).getByRole('button', { name: 'Remove post' }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove this post?' })
    await dialog.getByLabel(/Reason/).fill('Targeted harassment')
    await dialog.getByRole('button', { name: 'Remove post' }).click()
    await expect(page.getByText('The post was removed and its open reports resolved.')).toBeVisible()

    expect((await notifications(request, bad)).find((n) => n.type === 'POST_REMOVED')?.detail).toContain('Targeted harassment')
    const outcome = (await notifications(request, reporter)).find((n) => n.type === 'REPORT_OUTCOME')
    expect(outcome?.detail).toContain('we took action')
    expect(outcome?.detail).not.toContain('harassment') // the reporter never gets the note meant for the author
  })
})

test.describe('suspending and removing accounts', () => {
  test('suspend asks first, locks the account out and hides it; unsuspend brings it back', async ({ page, browser, request }) => {
    const { admin, bad, reporter } = await scene(request)
    await as(request, bad).post('visible before suspension')
    await as(request, reporter).reportUser(bad.username, 'SPAM')
    await signIn(page, admin, '/admin/reports')
    const report = row(page, `Report on @${bad.username}`)

    await report.getByRole('button', { name: 'Suspend account' }).click()
    const dialog = page.getByRole('dialog', { name: `Suspend @${bad.username}?` })
    await dialog.getByLabel(/Reason/).fill('Repeated spam')
    await page.screenshot(shot('admin-suspend-dialog'))
    await dialog.getByRole('button', { name: 'Suspend account' }).click()

    await expect(page.getByText('The account was suspended.')).toBeVisible()
    await page.getByRole('tab', { name: 'Handled' }).click()
    const handled = row(page, `Report on @${bad.username}`)
    await expect(handled).toContainText('Suspended')
    await expect(handled).toContainText(`Resolved by @${admin.username}`)
    await page.screenshot(shot('admin-suspended'))

    // The suspended person cannot sign in (a wrong password still looks like any wrong password), and others cannot find them.
    expect(await loginStatus(request, bad)).toBe(403)
    const login = await request.post('/api/auth/login', { data: { usernameOrEmail: bad.username, password: 'not-the-password' } })
    expect(login.status()).toBe(401)
    expect((await request.get(`/api/users/${bad.username}`, { headers: { Authorization: `Bearer ${reporter.accessToken}` } })).status()).toBe(404)
    const stranger = await (await browser.newContext()).newPage()
    await signIn(stranger, reporter, `/u/${bad.username}`)
    await expect(stranger.getByText("This account doesn't exist")).toBeVisible()

    await handled.getByRole('button', { name: 'Unsuspend account' }).click()
    await expect(page.getByText('The suspension was lifted.')).toBeVisible()
    await expect(handled.getByRole('button', { name: 'Suspend account' })).toBeVisible()
    expect(await loginStatus(request, bad)).toBe(200)
    await stranger.goto(`/u/${bad.username}`)
    await expect(stranger.getByText('visible before suspension')).toBeVisible()
  })

  test('the suspended person sees why on the sign-in page', async ({ page, request }) => {
    const { admin, bad } = await scene(request)
    await as(request, admin).get('/api/users/me')
    const res = await request.post(`/api/admin/users/${(await as(request, bad).get('/api/users/me')).id}/suspend`, { headers: { Authorization: `Bearer ${admin.accessToken}` }, data: {} })
    expect(res.status()).toBe(204)

    await page.goto('/login')
    await page.getByLabel(/username or email/i).fill(bad.username)
    await page.getByLabel('Password', { exact: true }).fill(bad.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page.getByText('Account suspended')).toBeVisible()
  })

  test('removing an account needs its username typed, and then it is gone for good', async ({ page, request }) => {
    const { admin, bad, reporter } = await scene(request)
    await as(request, bad).post('this goes with the account')
    await as(request, reporter).reportUser(bad.username, 'SPAM')
    await signIn(page, admin, '/admin/reports')

    await row(page, `Report on @${bad.username}`).getByRole('button', { name: 'Remove account' }).click()
    const dialog = page.getByRole('dialog', { name: `Remove @${bad.username}?` })
    const confirm = dialog.getByRole('button', { name: 'Remove account' })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(`Type ${bad.username} to confirm`).fill(bad.username)
    await page.screenshot(shot('admin-remove-account-dialog'))
    await confirm.click()

    await expect(page.getByText('The account was removed.')).toBeVisible()
    await page.getByRole('tab', { name: 'Handled' }).click()
    const handled = row(page, /Report on @/).filter({ hasText: 'Removed' })
    await expect(handled.first()).toBeVisible()
    expect(await loginStatus(request, bad)).toBe(401)
    expect((await notifications(request, reporter)).some((n) => n.type === 'REPORT_OUTCOME')).toBe(true)
  })
})
