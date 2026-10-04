import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { as, createUser, setAdmin, signIn } from './support'

// An automated accessibility check (axe-core, WCAG 2.0/2.1 A and AA rules) of every screen with realistic content on it.
// It finds what a machine can find: missing names and labels, bad roles, low contrast, duplicate ids, landmarks. It does not
// replace trying the app with a keyboard and a screen reader, but it keeps the basics from slipping back.

async function expectAccessible(page: Page, what: string) {
  const expected = await page.evaluate(() => (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  await expect(page.locator('html'), `the ${expected} theme should be showing on ${what}`).toHaveAttribute('data-theme', expected)
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(background, `page background on ${what}`).toBe(expected === 'light' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)')
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n    ')}`)
  expect.soft(summary, `accessibility problems on ${what}`).toEqual([])
}

async function ready(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await page.waitForLoadState('networkidle')
}

// Every screen is scanned in both themes (the page follows the emulated device setting, which is what "Device" means).
for (const colorScheme of ['dark', 'light'] as const) {
test.describe(`accessibility (${colorScheme} theme)`, () => {
test.use({ colorScheme })

test.describe('signed out', () => {
  for (const [path, what] of [['/login', 'sign in'], ['/register', 'register'], ['/forgot-password', 'forgot password']] as const) {
    test(what, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading').first()).toBeVisible()
      await expectAccessible(page, what)
    })
  }
})

test.describe('signed in', () => {
  test('every main screen', async ({ page, request, browser }) => {
    test.setTimeout(180_000)
    const me = await createUser(request, { displayName: 'Axe Tester' })
    const friend = await createUser(request, { displayName: 'Friendly Fran' })
    const post = await as(request, friend).post('a post with a #axetag hashtag and a mention of @' + me.username)
    await as(request, friend).post('a second post to scroll past')
    await as(request, me).follow(friend.username)
    await as(request, me).like(post.id)
    await as(request, me).bookmark(post.id)
    await as(request, friend).like((await as(request, me).post('my own post')).id)
    const conv = await as(request, friend).startConversation(me.username)
    await as(request, friend).sendMessage(conv.id, 'hello from Fran')
    await as(request, me).setProtected()
    const asker = await createUser(request, { displayName: 'Asking Alex' })
    await as(request, asker).requestFollow(me.username)

    await signIn(page, me, '/')
    await ready(page)
    await expectAccessible(page, 'home')
    for (const [path, what] of [
      [`/post/${post.id}`, 'a post'],
      [`/u/${me.username}`, 'own profile'],
      [`/u/${friend.username}`, 'someone else\'s profile'],
      [`/u/${friend.username}/followers`, 'followers'],
      ['/explore', 'explore'],
      ['/explore?q=axetag', 'search results'],
      ['/hashtag/axetag', 'hashtag'],
      ['/bookmarks', 'bookmarks'],
      ['/notifications', 'notifications'],
      ['/messages', 'inbox'],
      [`/messages/${conv.id}`, 'a chat'],
      ['/follow-requests', 'follow requests'],
      ['/settings', 'settings'],
    ] as const) {
      await page.goto(path)
      await ready(page)
      await expectAccessible(page, what)
    }

    // The admin page, in its own session.
    const admin = await createUser(request, { displayName: 'Ada Axe' })
    await setAdmin(admin.username)
    await as(request, asker).reportPost(post.id, 'SPAM')
    await as(request, asker).reportUser(friend.username, 'SPAM')
    const adminPage = await (await browser.newContext()).newPage()
    await signIn(adminPage, admin, '/admin/reports')
    await ready(adminPage)
    await expectAccessible(adminPage, 'admin reports (accounts)')
    await adminPage.getByRole('tab', { name: 'Posts' }).click()
    await expect(adminPage.getByRole('article').first()).toBeVisible()
    await expectAccessible(adminPage, 'admin reports (posts)')
  })

  test('dialogs and menus', async ({ page, request }) => {
    const me = await createUser(request)
    const other = await createUser(request, { displayName: 'Other Olly' })
    const post = await as(request, other).post('post to open a menu on')
    await signIn(page, me, `/post/${post.id}`)
    await ready(page)

    await page.getByRole('button', { name: 'More actions' }).first().click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expectAccessible(page, 'a post menu')
    await page.getByRole('menuitem', { name: 'Report post' }).click()
    await expect(page.getByRole('dialog', { name: 'Report post' })).toBeVisible()
    await expectAccessible(page, 'the report dialog')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'New post' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectAccessible(page, 'the compose dialog')
    await page.keyboard.press('Escape')

    await page.goto('/settings')
    await ready(page)
    await page.getByRole('button', { name: 'Delete account' }).first().click()
    await expect(page.getByRole('dialog', { name: 'Delete your account?' })).toBeVisible()
    await expectAccessible(page, 'the delete account dialog')
  })
})
})
}
