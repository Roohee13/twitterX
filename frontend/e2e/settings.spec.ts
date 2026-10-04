import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { as, createUser, setAdmin, shot, signIn, uniqueName, type TestUser } from './support'

const form = (page: Page, name: string) => page.getByRole('form', { name })
const loginStatus = async (request: APIRequestContext, usernameOrEmail: string, password: string) =>
  (await request.post('/api/auth/login', { data: { usernameOrEmail, password } })).status()

async function signInThroughTheForm(page: Page, usernameOrEmail: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Username or email').fill(usernameOrEmail)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('account settings', () => {
  test('a new username works at once: the profile link, the address, and the old name is gone', async ({ page, request }) => {
    const user = await createUser(request, { displayName: 'Renamer Rae' })
    await as(request, user).post('a post from before the rename')
    const newName = uniqueName('ren')
    await signIn(page, user, '/settings')

    await form(page, 'Username').getByLabel('Username').fill(newName)
    await form(page, 'Username').getByRole('button', { name: 'Change username' }).click()
    await expect(page.getByText(`Your username is now @${newName}.`)).toBeVisible()
    await page.screenshot(shot('settings-account'))

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Profile' }).click()
    await expect(page).toHaveURL(new RegExp(`/u/${newName}$`))
    await expect(page.getByText('a post from before the rename')).toBeVisible()
    await page.goto(`/u/${user.username}`)
    await expect(page.getByText("This account doesn't exist")).toBeVisible()
  })

  test('a taken username is refused under the field', async ({ page, request }) => {
    const user = await createUser(request)
    const other = await createUser(request)
    await signIn(page, user, '/settings')
    await form(page, 'Username').getByLabel('Username').fill(other.username)
    await form(page, 'Username').getByRole('button', { name: 'Change username' }).click()
    await expect(form(page, 'Username').getByText(/already taken/i)).toBeVisible()
  })

  test('changing the email asks you to verify it again', async ({ page, request }) => {
    const user = await createUser(request)
    const email = `${uniqueName('new')}@example.com`
    await signIn(page, user, '/settings')
    await form(page, 'Email').getByLabel('Email').fill(email)
    await form(page, 'Email').getByRole('button', { name: 'Change email' }).click()
    await expect(form(page, 'Email').getByText(`We sent a link to ${email}.`)).toBeVisible()
    await expect(page.getByText(/Please verify your email address/)).toBeVisible()
  })

  test('a new password signs you out; the old one stops working and the new one signs in', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user, '/settings')
    const card = form(page, 'Password')
    await card.getByLabel('Current password').fill('wrong-current')
    await card.getByLabel('New password').fill('brand-new-pass-1')
    await card.getByRole('button', { name: 'Change password' }).click()
    await expect(card.getByText('Current password is incorrect')).toBeVisible()
    await expect(page).toHaveURL(/\/settings$/) // still signed in

    await card.getByLabel('Current password').fill(user.password)
    await card.getByRole('button', { name: 'Change password' }).click()

    await expect(page).toHaveURL(/\/login/)
    expect(await loginStatus(request, user.username, user.password)).toBe(401)
    await signInThroughTheForm(page, user.username, 'brand-new-pass-1')
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  })

  test('protecting the account hides it from strangers at once, and it can be made public again', async ({ page, request, browser }) => {
    const owner = await createUser(request, { displayName: 'Private Pat' })
    await as(request, owner).post('only for approved followers')
    const stranger = await createUser(request)
    const strangerPage = await (await browser.newContext()).newPage()
    await signIn(page, owner, '/settings')

    const toggle = page.getByRole('switch', { name: 'Protect my account' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(page.getByText('Your account is now protected.')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Follow requests' })).toBeVisible()
    await page.screenshot(shot('settings-privacy'))

    await signIn(strangerPage, stranger, `/u/${owner.username}`)
    await expect(strangerPage.getByText('only for approved followers')).toHaveCount(0)
    await expect(strangerPage.getByLabel('Protected account').first()).toBeVisible()

    await toggle.click()
    await expect(page.getByText('Your account is now public.')).toBeVisible()
    await strangerPage.reload()
    await expect(strangerPage.getByText('only for approved followers')).toBeVisible()
  })

  test('blocked and muted accounts are listed and can be undone', async ({ page, request }) => {
    const me = await createUser(request)
    const blocked = await createUser(request, { displayName: 'Bob Blocked' })
    const muted = await createUser(request, { displayName: 'Mia Muted' })
    await as(request, me).block(blocked.username)
    await as(request, me).get('/api/users/me') // keep the helper typed
    await request.post(`/api/users/${muted.username}/mute`, { headers: { Authorization: `Bearer ${me.accessToken}` } })
    await signIn(page, me, '/settings')

    const blockedList = page.getByRole('region', { name: 'Blocked accounts' })
    const mutedList = page.getByRole('region', { name: 'Muted accounts' })
    await expect(blockedList).toContainText('Bob Blocked')
    await expect(mutedList).toContainText('Mia Muted')
    await page.screenshot(shot('settings-lists'))

    await blockedList.getByRole('button', { name: `Unblock @${blocked.username}` }).click()
    await expect(page.getByText(`Unblocked @${blocked.username}.`)).toBeVisible()
    await expect(blockedList).toContainText('You have not blocked anyone')
    await mutedList.getByRole('button', { name: `Unmute @${muted.username}` }).click()
    await expect(mutedList).toContainText('You have not muted anyone')

    await page.goto(`/u/${blocked.username}`)
    await expect(page.getByRole('button', { name: `Follow @${blocked.username}` })).toBeVisible() // no longer shown as blocked
    await expect(page.getByRole('button', { name: `Unblock @${blocked.username}` })).toHaveCount(0)
  })

  test('deactivating signs you out everywhere, and signing in again brings the account back', async ({ page, request }) => {
    const user = await createUser(request, { displayName: 'Taking A Break' })
    const visitor = await createUser(request)
    await signIn(page, user, '/settings')
    await page.getByRole('button', { name: 'Deactivate', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Deactivate your account?' })
    await page.screenshot(shot('settings-deactivate'))
    await dialog.getByRole('button', { name: 'Deactivate' }).click()

    await expect(page).toHaveURL(/\/login/)
    expect((await request.get(`/api/users/${user.username}`, { headers: { Authorization: `Bearer ${visitor.accessToken}` } })).status()).toBeLessThan(500)
    await signInThroughTheForm(page, user.username, user.password)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await page.goto(`/u/${user.username}`)
    await expect(page.getByRole('heading', { name: 'Taking A Break', level: 2 })).toBeVisible()
  })

  test('deleting needs the password and the username, then the account is gone for good', async ({ page, request }) => {
    const user = await createUser(request, { displayName: 'Leaving Lee' })
    const visitor = await createUser(request)
    await as(request, user).post('this will be erased')
    await signIn(page, user, '/settings')
    await page.getByRole('button', { name: 'Delete account' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Delete your account?' })
    const confirm = dialog.getByRole('button', { name: 'Delete account' })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(`Type ${user.username} to confirm`).fill(user.username)
    await dialog.getByLabel('Your password').fill('not-my-password')
    await page.screenshot(shot('settings-delete-dialog'))
    await confirm.click()
    await expect(dialog.getByText('Current password is incorrect')).toBeVisible()

    await dialog.getByLabel('Your password').fill(user.password)
    await confirm.click()

    await expect(page).toHaveURL(/\/login/)
    expect(await loginStatus(request, user.username, user.password)).toBe(401)
    expect((await request.get(`/api/users/${user.username}`, { headers: { Authorization: `Bearer ${visitor.accessToken}` } })).status()).toBe(404)
  })
})

test.describe('email delivery check', () => {
  test('only admins see it; with no mail server configured it says so (the e2e backend has none)', async ({ page, request, browser }) => {
    const normal = await createUser(request)
    await signIn(page, normal, '/settings')
    await expect(form(page, 'Password')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Email delivery' })).toHaveCount(0)

    const admin = await createUser(request, { displayName: 'Ada Mailer' })
    await setAdmin(admin.username)
    const adminPage = await (await browser.newContext()).newPage()
    await signIn(adminPage, admin, '/settings')
    const section = adminPage.getByRole('region', { name: 'Email delivery' })
    await expect(section).toContainText(admin.email)
    await section.getByRole('button', { name: 'Send test email' }).click()
    await expect(section.getByRole('alert')).toContainText('Email is not configured: set SPRING_MAIL_HOST')
    await adminPage.screenshot(shot('settings-email-test'))
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } })

  test('Settings is reachable from your profile and the page fits the screen', async ({ page, request }) => {
    const user: TestUser = await createUser(request)
    await signIn(page, user, `/u/${user.username}`)
    await page.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(form(page, 'Password')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('settings-phone'))
  })
})
