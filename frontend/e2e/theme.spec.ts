import { expect, test, type Page } from '@playwright/test'
import { as, createUser, setAdmin, shot, signIn } from './support'

const html = (page: Page) => page.locator('html')
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

test.describe('theme', () => {
  test.describe('on a light device', () => {
    test.use({ colorScheme: 'light' })

    test('follows the device when nothing was chosen', async ({ page, request }) => {
      const user = await createUser(request)
      await signIn(page, user)
      await expect(nav(page)).toBeVisible()
      await expect(html(page)).toHaveAttribute('data-theme', 'light')
      expect(await background(page)).toBe('rgb(255, 255, 255)')
    })

    test('an explicit choice of dark beats the device and survives a reload', async ({ page, request }) => {
      const user = await createUser(request)
      await signIn(page, user)
      await page.getByRole('button', { name: 'Switch to dark theme' }).click()
      await expect(html(page)).toHaveAttribute('data-theme', 'dark')
      expect(await background(page)).toBe('rgb(0, 0, 0)')

      await page.reload()

      await expect(nav(page)).toBeVisible()
      await expect(html(page)).toHaveAttribute('data-theme', 'dark')
      await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible()
    })
  })

  test.describe('on a dark device', () => {
    test.use({ colorScheme: 'dark' })

    test('follows the device, and the toggle gives the other theme', async ({ page, request }) => {
      const user = await createUser(request)
      await signIn(page, user)
      await expect(html(page)).toHaveAttribute('data-theme', 'dark')
      await page.getByRole('button', { name: 'Switch to light theme' }).click()
      await expect(html(page)).toHaveAttribute('data-theme', 'light')
      expect(await background(page)).toBe('rgb(255, 255, 255)')
    })

    test('settings: device, light and dark; "device" follows the OS while the page is open', async ({ page, request }) => {
      const user = await createUser(request)
      await signIn(page, user, '/settings')
      const group = page.getByRole('group', { name: 'Appearance' })
      await expect(group.getByRole('radio', { name: /^Device/ })).toBeChecked()

      await group.getByText('Light', { exact: true }).click()
      await expect(html(page)).toHaveAttribute('data-theme', 'light')
      await page.screenshot(shot('theme-settings-light'))
      await group.getByText('Dark', { exact: true }).click()
      await expect(html(page)).toHaveAttribute('data-theme', 'dark')

      await group.getByText('Device', { exact: true }).click()
      await expect(html(page)).toHaveAttribute('data-theme', 'dark') // the device is dark
      await page.emulateMedia({ colorScheme: 'light' }) // the device switches (sunrise, a manual change in the OS)
      await expect(html(page)).toHaveAttribute('data-theme', 'light')
      await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible() // the toggle follows too
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(html(page)).toHaveAttribute('data-theme', 'dark')

      // An explicit choice ignores the device.
      await group.getByText('Light', { exact: true }).click()
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect(html(page)).toHaveAttribute('data-theme', 'light')
    })

    test('the right colours are there before the app has loaded (no flash of the wrong theme)', async ({ page, request }) => {
      const user = await createUser(request)
      await signIn(page, user)
      await page.getByRole('button', { name: 'Switch to light theme' }).click()
      await expect(html(page)).toHaveAttribute('data-theme', 'light')

      // Hold back every script of the app: what is drawn now is what a visitor sees before it loads.
      let release!: () => void
      const held = new Promise<void>((resolve) => { release = resolve })
      await page.route('**/assets/**', async (route) => {
        if (route.request().url().endsWith('.js')) await held
        await route.continue()
      })
      // The page's own scripts are deferred, so "domcontentloaded" would wait for the held ones: look as soon as the document has arrived.
      await page.goto('/', { waitUntil: 'commit' })

      await expect(html(page)).toHaveAttribute('data-theme', 'light') // set by the small blocking script in <head>
      expect(await background(page)).toBe('rgb(255, 255, 255)')
      expect(await page.locator('#root').innerHTML()).toBe('') // the app really has not started
      release()
      await expect(nav(page)).toBeVisible()
      await expect(html(page)).toHaveAttribute('data-theme', 'light')
    })

    test('the sign-in page has the toggle too, and the choice is still there after signing in', async ({ page, request }) => {
      const user = await createUser(request)
      await page.goto('/login')
      await page.getByRole('button', { name: 'Switch to light theme' }).click()
      await expect(html(page)).toHaveAttribute('data-theme', 'light')
      await page.screenshot(shot('theme-login-light'))

      await page.getByLabel('Username or email').fill(user.username)
      await page.getByLabel('Password', { exact: true }).fill(user.password)
      await page.getByRole('button', { name: 'Sign in' }).click()

      await expect(nav(page)).toBeVisible()
      await expect(html(page)).toHaveAttribute('data-theme', 'light')
    })

    test('two tabs: a change in one shows in the other', async ({ page, request, context }) => {
      const user = await createUser(request)
      await signIn(page, user)
      const other = await context.newPage()
      await other.goto('/')
      await expect(other.getByRole('navigation', { name: 'Main' })).toBeVisible()
      await expect(html(other)).toHaveAttribute('data-theme', 'dark')

      await page.getByRole('button', { name: 'Switch to light theme' }).click()

      await expect(html(other)).toHaveAttribute('data-theme', 'light')
    })
  })
})

// Pictures of the light theme for a visual review (they are git-ignored, like the other screenshots).
test.describe('light theme, screen by screen', () => {
  test.use({ colorScheme: 'light' })

  test('screenshots', async ({ page, request, browser }) => {
    test.setTimeout(120_000)
    const me = await createUser(request, { displayName: 'Lina Light' })
    const friend = await createUser(request, { displayName: 'Friendly Fran' })
    const post = await as(request, friend).post('a post with a #lighttag hashtag, a mention of @' + me.username + ' and a link-like thing')
    await as(request, me).follow(friend.username)
    await as(request, me).like(post.id)
    await as(request, me).post('my own post, to look at the actions row')
    await as(request, friend).like((await as(request, me).post('another post of mine')).id)
    const conv = await as(request, friend).startConversation(me.username)
    await as(request, friend).sendMessage(conv.id, 'hello from Fran')
    await as(request, me).sendMessage(conv.id, 'hi Fran, how are you?')
    await as(request, friend).sendMessage(conv.id, 'a longer reply that wraps onto a second line so the bubble shape is visible')
    await signIn(page, me, '/')
    await expect(nav(page)).toBeVisible()
    await page.waitForLoadState('networkidle')
    for (const [path, name] of [['/', 'home'], [`/post/${post.id}`, 'post'], [`/u/${friend.username}`, 'profile'], ['/explore?q=lighttag', 'search'], ['/notifications', 'notifications'], ['/messages', 'inbox'], [`/messages/${conv.id}`, 'chat'], ['/settings', 'settings'], ['/bookmarks', 'bookmarks']] as const) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(250)
      await page.screenshot({ path: `e2e/screenshots/theme-light-${name}.png`, fullPage: false })
    }
    await page.goto(`/post/${post.id}`)
    await page.getByRole('button', { name: 'More actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Report post' }).click()
    await page.waitForTimeout(250)
    await page.screenshot({ path: 'e2e/screenshots/theme-light-dialog.png' })

    const admin = await createUser(request, { displayName: 'Ada Admin' })
    await setAdmin(admin.username)
    await as(request, me).reportPost(post.id, 'SPAM')
    const adminPage = await (await browser.newContext({ colorScheme: 'light' })).newPage()
    await signIn(adminPage, admin, '/admin/reports?tab=posts')
    await expect(adminPage.getByRole('article').first()).toBeVisible()
    await adminPage.screenshot({ path: 'e2e/screenshots/theme-light-admin.png' })
  })
})
