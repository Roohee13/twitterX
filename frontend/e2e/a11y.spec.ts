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
    const mine = await as(request, me).sendMessage(conv.id, 'a message I will edit')
    await request.patch(`/api/conversations/${conv.id}/messages/${mine.id}`, { headers: { Authorization: `Bearer ${me.accessToken}` }, data: { content: 'a message I edited' } })
    const gone = await as(request, friend).sendMessage(conv.id, 'a message Fran deleted')
    await as(request, friend).deleteMessage(conv.id, gone.id)
    await as(request, me).setProtected()
    const asker = await createUser(request, { displayName: 'Asking Alex' })
    await as(request, asker).requestFollow(me.username)

    await signIn(page, me, '/')
    await ready(page)
    await expectAccessible(page, 'home (Following)')
    await page.getByRole('tab', { name: 'For you' }).click()
    await expect(page.getByRole('tabpanel').getByRole('article').first()).toBeVisible()
    await expectAccessible(page, 'home (For you)')
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
      [`/messages/${conv.id}`, 'a chat with an edited and a deleted message'],
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
    await adminPage.goto('/settings')
    await expect(adminPage.getByRole('region', { name: 'Email delivery' })).toBeVisible()
    await ready(adminPage)
    await expectAccessible(adminPage, 'settings with the admin email tool')
    await adminPage.getByRole('button', { name: 'Check image storage' }).click()
    await expect(adminPage.getByRole('list', { name: 'Check results' })).toBeVisible()
    await expectAccessible(adminPage, 'settings with the image storage result')
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

    // The edit / delete menu on a message, and the inline editor.
    const other2 = await createUser(request)
    const chat = await as(request, me).startConversation(other2.username)
    await as(request, me).sendMessage(chat.id, 'message with a menu')
    await page.goto(`/messages/${chat.id}`)
    await ready(page)
    await page.getByText('message with a menu').hover()
    await page.getByRole('button', { name: 'Message actions' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expectAccessible(page, 'the message menu')
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await expect(page.getByRole('textbox', { name: 'Edit message' })).toBeVisible()
    await expectAccessible(page, 'the message editor')
    await page.keyboard.press('Escape')
    await page.getByText('message with a menu').hover()
    await page.getByRole('button', { name: 'Message actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(page.getByRole('dialog', { name: 'Delete this message?' })).toBeVisible()
    await expectAccessible(page, 'the delete message dialog')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Conversation actions' }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await expectAccessible(page, 'the conversation menu')
    await page.getByRole('menuitem', { name: 'Delete conversation' }).click()
    await expect(page.getByRole('dialog', { name: 'Delete this conversation?' })).toBeVisible()
    await expectAccessible(page, 'the delete conversation dialog')
    await page.keyboard.press('Escape')

    // A deactivated account: the blank profile and the read-only conversation with it.
    const leaver = await createUser(request, { displayName: 'Leaving Lou' })
    const leaverChat = await as(request, other).startConversation(leaver.username)
    await as(request, leaver).sendMessage(leaverChat.id, 'my last message')
    await request.post('/api/users/me/deactivate', { headers: { Authorization: `Bearer ${leaver.accessToken}` } })
    await page.goto(`/u/${leaver.username}`)
    await expect(page.getByText('This account is unavailable.')).toBeVisible()
    await expectAccessible(page, 'the blank profile of a deactivated account')
    await signIn(page, other, `/messages/${leaverChat.id}`)
    await expect(page.getByText('my last message')).toBeVisible()
    await expectAccessible(page, 'a read-only conversation with a deactivated account')

    await page.goto('/settings')
    await ready(page)
    await page.getByRole('button', { name: 'Delete account' }).first().click()
    await expect(page.getByRole('dialog', { name: 'Delete your account?' })).toBeVisible()
    await expectAccessible(page, 'the delete account dialog')
  })
})
})
}
