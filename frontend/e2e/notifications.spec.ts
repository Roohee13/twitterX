import { expect, test, type Page } from '@playwright/test'
import { as, createUser, loginViaApi, setAdmin, shot, signIn } from './support'

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const bell = (page: Page, name: string | RegExp = /^Notifications/) => mainNav(page).getByRole('link', { name })

test.describe('notifications', () => {
  test('a like shows up live on the badge and in the list, and opening it marks it read', async ({ page, request }) => {
    const author = await createUser(request, { displayName: 'Pat Poster' })
    const fan = await createUser(request, { displayName: 'Fay Fan' })
    const post = await as(request, author).post('please like this one')
    await signIn(page, author)
    await expect(bell(page, 'Notifications')).toBeVisible() // loaded, and no unread yet

    await as(request, fan).like(post.id) // happens while the author is looking at the home page

    await expect(bell(page, 'Notifications (1 unread)')).toBeVisible() // no reload
    await bell(page).click()
    const row = page.getByRole('article', { name: 'Unread: Fay Fan liked your post' })
    await expect(row).toBeVisible()
    await expect(row).toContainText('please like this one')
    await page.screenshot(shot('notifications-unread'))

    await row.getByRole('link').click()

    await expect(page).toHaveURL(new RegExp(`/post/${post.id}$`))
    await expect(bell(page, 'Notifications')).toBeVisible() // badge gone
    await page.goto('/notifications')
    await expect(page.getByRole('article', { name: 'Fay Fan liked your post' })).toBeVisible() // still there, no longer unread
  })

  test('a follow request arrives live and leads to the requests page', async ({ page, request }) => {
    const owner = await createUser(request, { displayName: 'Olive Owner' })
    await as(request, owner).setProtected()
    const asker = await createUser(request, { displayName: 'Ray Requester' })
    await signIn(page, owner, '/notifications')
    await expect(page.getByText('Nothing here yet')).toBeVisible()

    await as(request, asker).requestFollow(owner.username)

    const row = page.getByRole('article', { name: 'Unread: Ray Requester asked to follow you' })
    await expect(row).toBeVisible() // pushed into the open list
    await row.getByRole('link').click()
    await expect(page).toHaveURL(/\/follow-requests$/)
    await expect(page.getByText('Ray Requester')).toBeVisible()
  })

  test('mark all read and delete work and survive a reload', async ({ page, request }) => {
    const me = await createUser(request)
    const a = await createUser(request, { displayName: 'Ann Actor' })
    const b = await createUser(request, { displayName: 'Bea Actor' })
    await as(request, a).follow(me.username)
    await as(request, b).follow(me.username)
    await signIn(page, me, '/notifications')
    await expect(bell(page, 'Notifications (2 unread)')).toBeVisible()

    await page.getByRole('button', { name: 'Mark all read' }).click()
    await expect(bell(page, 'Notifications')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark all read' })).toBeDisabled()
    await page.reload()
    await expect(page.getByRole('article', { name: 'Ann Actor followed you' })).toBeVisible()
    await expect(page.getByRole('article', { name: /^Unread/ })).toHaveCount(0)

    await page.getByRole('article', { name: 'Ann Actor followed you' }).getByRole('button', { name: 'Delete notification' }).click()
    await expect(page.getByRole('article', { name: 'Ann Actor followed you' })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('article', { name: 'Bea Actor followed you' })).toBeVisible()
    await expect(page.getByRole('article', { name: 'Ann Actor followed you' })).toHaveCount(0)
  })

  test('moderation: the admin is alerted, the author is told live, and the reporter hears the outcome', async ({ browser, page, request }) => {
    const admin = await createUser(request, { displayName: 'Ada Admin' })
    await setAdmin(admin.username)
    const author = await createUser(request, { displayName: 'Bad Poster' })
    const reporter = await createUser(request, { displayName: 'Rita Reporter' })
    const post = await as(request, author).post('against the rules')
    const reporterPage = await (await browser.newContext()).newPage()
    await signIn(page, author, '/notifications') // the author watches their notifications
    await signIn(reporterPage, reporter, '/notifications')

    await as(request, reporter).reportPost(post.id, 'HARASSMENT')
    const adminPage = await (await browser.newContext()).newPage()
    await signIn(adminPage, await loginViaApi(request, admin), '/notifications')
    const alert = adminPage.getByRole('article', { name: new RegExp(`New report: a post by @${author.username}`) })
    await expect(alert).toBeVisible()
    await alert.getByRole('link').click()
    await expect(adminPage).toHaveURL(/\/admin\/reports$/)
    await adminPage.getByRole('tab', { name: 'Posts' }).click()
    await adminPage.getByRole('button', { name: 'Remove post' }).first().click()
    await adminPage.getByRole('dialog', { name: 'Remove this post?' }).getByLabel(/Reason/).fill('Targeted harassment')
    await adminPage.getByRole('dialog', { name: 'Remove this post?' }).getByRole('button', { name: 'Remove post' }).click()

    const removed = page.getByRole('article', { name: /An admin removed your post/ })
    await expect(removed).toBeVisible() // pushed live
    await expect(removed).toContainText('Reason: Targeted harassment')
    await expect(removed.getByRole('link')).toHaveCount(0)
    await page.screenshot(shot('notifications-moderation'))
    const outcome = reporterPage.getByRole('article', { name: /we took action/ })
    await expect(outcome).toBeVisible()
    await expect(outcome).not.toContainText('harassment')
  })

  test('two tabs of the same user both get the notification live', async ({ browser, page, request }) => {
    const me = await createUser(request)
    const other = await createUser(request, { displayName: 'Nina Newfollower' })
    await signIn(page, me)
    const second = await (await browser.newContext()).newPage()
    await signIn(second, await loginViaApi(request, me), '/notifications')
    await expect(bell(page, 'Notifications')).toBeVisible()

    await as(request, other).follow(me.username)

    await expect(bell(page, 'Notifications (1 unread)')).toBeVisible()
    await expect(second.getByRole('article', { name: 'Unread: Nina Newfollower followed you' })).toBeVisible()
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } })

  test('the bell and the list fit the screen', async ({ page, request }) => {
    const me = await createUser(request)
    const other = await createUser(request, { displayName: 'Mo Mobile' })
    await as(request, other).follow(me.username)
    await signIn(page, me, '/notifications')
    await expect(page.getByRole('article', { name: 'Unread: Mo Mobile followed you' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main (mobile)' }).getByRole('link', { name: 'Notifications (1 unread)' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('notifications-phone'))
  })
})
