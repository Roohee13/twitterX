import { expect, test } from '@playwright/test'
import { as, createUser, signIn } from './support'

// Using the app without a mouse: what the first Tab does, whether every page says where you are, and whether menus and dialogs
// give focus back. (The automated axe scan in a11y.spec.ts checks names, roles and contrast; this checks the flow.)

test.describe('keyboard', () => {
  test('the first Tab offers to skip the navigation, and Enter lands on the page', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user, '/notifications')
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()

    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to main content' })
    await expect(skip).toBeFocused()
    await expect(skip).toBeVisible() // it shows itself when focused

    await page.keyboard.press('Enter')
    await expect(page.getByRole('main')).toBeFocused()
    await page.keyboard.press('Tab')
    // Next stop is inside the page (the "Mark all read" button), not back in the sidebar.
    expect(await page.evaluate(() => !!document.activeElement?.closest('main'))).toBe(true)
  })

  test('every page sets a title that says where you are', async ({ page, request }) => {
    const user = await createUser(request, { displayName: 'Title Tester' })
    const other = await createUser(request, { displayName: 'Other Person' })
    const post = await as(request, other).post('a post')
    const { id } = await as(request, other).startConversation(user.username)
    await as(request, other).sendMessage(id, 'hi')
    await signIn(page, user, '/')
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()

    for (const [path, title] of [
      ['/', 'Home / XClone'],
      ['/explore', 'Explore / XClone'],
      ['/explore?q=hello', 'Search: hello / XClone'],
      ['/notifications', 'Notifications / XClone'],
      ['/messages', 'Messages / XClone'],
      [`/messages/${id}`, 'Other Person / XClone'],
      ['/bookmarks', 'Bookmarks / XClone'],
      ['/settings', 'Settings / XClone'],
      [`/u/${user.username}`, 'Title Tester / XClone'],
      [`/post/${post.id}`, 'Post / XClone'],
      ['/no/such/page', 'Page not found / XClone'],
    ] as const) {
      await page.goto(path)
      await expect(page, `title of ${path}`).toHaveTitle(title)
    }
  })

  test('the sign-in and register pages have their own titles too', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle('Sign in to XClone / XClone')
    await page.goto('/register')
    await expect(page).toHaveTitle('Create your account / XClone')
  })

  test('a menu closes with Escape and gives focus back to the button that opened it', async ({ page, request }) => {
    const user = await createUser(request)
    const other = await createUser(request)
    const post = await as(request, other).post('post with a menu')
    await signIn(page, user, `/post/${post.id}`)
    const trigger = page.getByRole('button', { name: 'More actions' }).first()
    await expect(trigger).toBeVisible()

    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')

    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('a dialog closes with Escape and focus returns to what opened it', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user, '/settings')
    const opener = page.getByRole('button', { name: 'Deactivate', exact: true })
    await opener.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Deactivate your account?' })).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test('you can write and send a post with the keyboard alone', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user, '/')
    const box = page.getByRole('textbox', { name: 'Post text' })
    await expect(box).toBeVisible()
    await box.focus()
    await page.keyboard.type('typed without touching the mouse')
    await page.keyboard.press('Tab')
    // Walk forward until the Post button has focus (image, thread and other controls may sit in between).
    for (let i = 0; i < 8 && !(await page.getByRole('button', { name: 'Post', exact: true }).first().evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press('Tab')
    }
    await page.keyboard.press('Enter')
    await expect(page.getByRole('article').filter({ hasText: 'typed without touching the mouse' })).toBeVisible()
  })
})
