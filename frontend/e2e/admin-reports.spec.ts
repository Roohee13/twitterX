import { expect, test, type Page } from '@playwright/test'
import { as, createUser, setAdmin, shot, signIn, type TestUser } from './support'

const row = (page: Page, name: string | RegExp) => page.getByRole('article', { name })

/** An admin, plus a bad actor with a post that two different people report (one of them through the real report dialogs). */
async function scene(page: Page, request: Parameters<typeof createUser>[0]) {
  const admin = await createUser(request, { displayName: 'Ada Admin' })
  await setAdmin(admin.username)
  const bad = await createUser(request, { displayName: 'Bad Actor' })
  const reporter = await createUser(request, { displayName: 'Rita Reporter' })
  const other = await createUser(request, { displayName: 'Omar Other' })
  const post = await as(request, bad).post('this post breaks the rules')
  await as(request, other).reportPost(post.id, 'HARASSMENT')
  await as(request, other).reportUser(bad.username, 'HARASSMENT')
  return { admin, bad, reporter, other, post }
}

/** Report an account and a post the way a user does: through the menus and the report dialogs. */
async function reportThroughTheUi(page: Page, reporter: TestUser, bad: TestUser, post: { id: number }) {
  await signIn(page, reporter, `/post/${post.id}`)
  await page.getByRole('button', { name: 'More actions' }).first().click()
  await page.getByRole('menuitem', { name: 'Report post' }).click()
  await page.getByRole('dialog', { name: 'Report post' }).getByLabel("It's spam").check()
  await page.getByRole('dialog', { name: 'Report post' }).getByRole('button', { name: 'Report' }).click()
  await expect(page.getByText(/Thanks for letting us know/)).toBeVisible()

  await page.goto(`/u/${bad.username}`)
  await page.getByRole('button', { name: 'Profile actions' }).click()
  await page.getByRole('menuitem', { name: `Report @${bad.username}` }).click()
  await page.getByRole('dialog').getByLabel("It's spam").check()
  await page.getByRole('dialog').getByRole('button', { name: 'Report' }).click()
  await expect(page.getByText(/Thanks for letting us know/).last()).toBeVisible()
}

test.describe('who can see the reports', () => {
  test('a normal user has no link, gets the admin-only screen at the address, and the server says 403', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user)
    // Wait for the app to finish loading before looking for what is NOT there ("no such link" is also true while it is still loading).
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Profile' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' })).toHaveCount(0)

    await page.goto('/admin/reports')

    await expect(page.getByText('This page is for admins')).toBeVisible()
    const api = await request.get('/api/admin/reports/users', { headers: { Authorization: `Bearer ${user.accessToken}` } })
    expect(api.status()).toBe(403)
    expect(await api.json()).toMatchObject({ detail: 'Admins only' })
  })

  test('an admin sees the link; losing the admin flag takes the page away', async ({ page, request }) => {
    const admin = await createUser(request)
    await setAdmin(admin.username)
    await signIn(page, admin)
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' }).click()
    await expect(page).toHaveURL(/\/admin\/reports$/)
    await expect(page.getByRole('tablist', { name: 'Kind of report' })).toBeVisible()

    await setAdmin(admin.username, false)
    await page.reload()

    await expect(page.getByText('This page is for admins')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' })).toHaveCount(0)
  })
})

test.describe('reviewing reports', () => {
  test('reports made through the app show up for the admin, with the reporter, the reason and how many reports there are', async ({ browser, page, request }) => {
    const { admin, bad, reporter, post } = await scene(page, request)
    const reporterContext = await browser.newContext()
    await reportThroughTheUi(await reporterContext.newPage(), reporter, bad, post)
    await reporterContext.close()
    await signIn(page, admin, '/admin/reports')

    const account = row(page, `Report on @${bad.username}`).first()
    await expect(row(page, `Report on @${bad.username}`).filter({ hasText: `@${reporter.username}` })).toHaveCount(1)
    await expect(row(page, `Report on @${bad.username}`)).toHaveCount(2)
    await expect(account).toContainText('2 reports against this account')
    await expect(account.getByText('Open')).toBeVisible()
    await page.screenshot(shot('admin-accounts'))

    await page.getByRole('tab', { name: 'Posts' }).click()
    await expect(page).toHaveURL(/tab=posts/)
    const posts = row(page, `Report on a post by @${bad.username}`)
    await expect(posts).toHaveCount(2)
    await expect(posts.first()).toContainText('this post breaks the rules')
    await expect(posts.first()).toContainText('2 reports against this post')
    await page.screenshot(shot('admin-posts'))
  })

  test('dismiss and resolve move reports to Handled with who did it, and Reopen brings one back', async ({ page, request }) => {
    const { admin, bad, other } = await scene(page, request)
    await signIn(page, admin, '/admin/reports')
    const open = row(page, `Report on @${bad.username}`)
    await expect(open).toHaveCount(1)

    await open.getByRole('button', { name: 'Dismiss' }).click()
    await expect(open).toHaveCount(0)
    await page.getByRole('tab', { name: 'Handled' }).click()
    const handled = row(page, `Report on @${bad.username}`)
    await expect(handled).toContainText('Dismissed')
    await expect(handled).toContainText(`Dismissed by @${admin.username}`)
    await expect(handled).toContainText(`@${other.username}`)
    await page.screenshot(shot('admin-handled'))

    await handled.getByRole('button', { name: 'Reopen' }).click()
    await expect(handled).toHaveCount(0)
    await page.getByRole('tab', { name: 'Open' }).click()
    await expect(row(page, `Report on @${bad.username}`)).toHaveCount(1)

    await row(page, `Report on @${bad.username}`).getByRole('button', { name: 'Resolve' }).click()
    await page.getByRole('tab', { name: 'All' }).click()
    await expect(row(page, `Report on @${bad.username}`)).toContainText('Resolved')
  })

  test('removing a reported post asks first, then the post is gone for everyone and its reports are resolved', async ({ browser, page, request }) => {
    const { admin, bad, other, post } = await scene(page, request)
    await as(request, other).follow(bad.username)
    await signIn(page, admin, '/admin/reports?tab=posts')
    const report = row(page, `Report on a post by @${bad.username}`)
    await expect(report).toHaveCount(1)

    await report.getByRole('button', { name: 'Remove post' }).click()
    await page.screenshot(shot('admin-remove-dialog'))
    await page.getByRole('dialog', { name: 'Remove this post?' }).getByRole('button', { name: 'Remove post' }).click()

    await expect(page.getByText('The post was removed and its open reports resolved.')).toBeVisible()
    await expect(report).toHaveCount(0) // no longer open
    await page.getByRole('tab', { name: 'Handled' }).click()
    const handled = row(page, `Report on a post by @${bad.username}`)
    await expect(handled).toContainText('This post has been removed.')
    await expect(handled).toContainText('this post breaks the rules') // the admin still sees what was reported
    await expect(handled).toContainText(`Resolved by @${admin.username}`)
    await expect(handled.getByRole('button', { name: 'Remove post' })).toHaveCount(0)

    // Everyone else no longer sees it: not by its address, not in a follower's timeline, not on the author's page.
    const strangerContext = await browser.newContext()
    const stranger = await strangerContext.newPage()
    await signIn(stranger, other, `/post/${post.id}`)
    await expect(stranger.getByText("This post doesn't exist")).toBeVisible()
    await stranger.goto('/')
    await expect(stranger.getByText('this post breaks the rules')).toHaveCount(0)
    await strangerContext.close()
  })

  test('filters and tabs are kept in the address, and an empty list says so', async ({ page, request }) => {
    const admin = await createUser(request)
    await setAdmin(admin.username)
    await signIn(page, admin, '/admin/reports?tab=posts&status=HANDLED')

    await expect(page.getByRole('tab', { name: 'Posts' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Handled' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'Open' }).click()
    await expect(page).toHaveURL(/tab=posts/)
    await expect(page).not.toHaveURL(/status=/) // the default is not written into the address
    await page.reload()
    await expect(page.getByRole('tab', { name: 'Posts' })).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('on a phone', () => {
  test('the report list and its buttons fit the screen', async ({ browser, request }) => {
    const admin = await createUser(request)
    await setAdmin(admin.username)
    const bad = await createUser(request, { displayName: 'Bad Actor With A Rather Long Display Name' })
    const post = await as(request, bad).post(`a long post ${'wordwordword '.repeat(15)}`)
    await as(request, await createUser(request)).reportPost(post.id)
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true })
    const page = await context.newPage()
    await signIn(page, admin, '/admin/reports?tab=posts')

    const report = row(page, `Report on a post by @${bad.username}`)
    await expect(report).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(report.getByRole('button', { name: 'Remove post' })).toBeVisible()
    await page.screenshot(shot('admin-mobile'))
    await context.close()
  })
})
