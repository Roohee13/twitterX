import { expect, test, type Page } from '@playwright/test'
import { createUser, emailedLink, shot, signIn, uniqueName } from './support'

async function login(page: Page, who: string, password = 'password123') {
  await page.goto('/login')
  await page.getByLabel('Username or email').fill(who)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('registration', () => {
  test('a new user registers through the form and lands on the timeline with a verification banner', async ({ page }) => {
    const username = uniqueName('reg')
    await page.goto('/register')
    await page.screenshot(shot('auth-register'))

    await page.getByLabel('Name', { exact: true }).fill('Reggie Tester')
    await page.getByLabel('Username', { exact: true }).fill(username)
    await page.getByLabel('Email', { exact: true }).fill(`${username}@example.com`)
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Reggie Tester').first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Verify your email' })).toContainText(`${username}@example.com`)
    await page.screenshot(shot('auth-home-with-banner'))
  })

  test('mistakes are explained next to the field before anything is sent', async ({ page }) => {
    await page.goto('/register')
    const requests: string[] = []
    page.on('request', (r) => r.url().includes('/api/auth/register') && requests.push(r.url()))

    await page.getByLabel('Username', { exact: true }).fill('a!')
    await page.getByLabel('Email', { exact: true }).fill('not-an-email')
    await page.getByLabel('Password', { exact: true }).fill('short')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText('Enter a name')).toBeVisible()
    await expect(page.getByText('Use 3-15 letters, digits or underscores')).toBeVisible()
    await expect(page.getByText('Enter a valid email address')).toBeVisible()
    await expect(page.getByText('Use at least 8 characters')).toBeVisible()
    await expect(page.getByLabel('Username', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    await page.screenshot(shot('auth-register-errors'))
    expect(requests).toHaveLength(0)
  })

  test('a taken username or email is reported on the right field by the server', async ({ page, request }) => {
    const taken = await createUser(request)
    await page.goto('/register')
    await page.getByLabel('Name', { exact: true }).fill('Copycat')
    await page.getByLabel('Username', { exact: true }).fill(taken.username)
    await page.getByLabel('Email', { exact: true }).fill(`other-${taken.username}@example.com`)
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByLabel('Username', { exact: true })).toHaveAccessibleDescription('Username is already taken')

    await page.getByLabel('Username', { exact: true }).fill(uniqueName('free'))
    await page.getByLabel('Email', { exact: true }).fill(taken.email)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByLabel('Email', { exact: true })).toHaveAccessibleDescription('Email is already registered')
    await expect(page).toHaveURL(/\/register$/)
  })
})

test.describe('login and logout', () => {
  test('signs in with the username or with the email', async ({ page, request }) => {
    const user = await createUser(request)

    await login(page, user.username)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText(user.displayName).first()).toBeVisible()

    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await login(page, user.email.toUpperCase())
    await expect(page.getByText(user.displayName).first()).toBeVisible()
  })

  test('a wrong password shows the server message and keeps the form', async ({ page, request }) => {
    const user = await createUser(request)

    await login(page, user.username, 'wrong-password')

    await expect(page.getByRole('alert')).toHaveText('Invalid credentials')
    await expect(page).toHaveURL(/\/login$/)
    await page.screenshot(shot('auth-login-error'))
  })

  test('missing fields are flagged without a request', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Enter your username or email')).toBeVisible()
    await expect(page.getByText('Enter your password')).toBeVisible()
  })

  test('after signing in the visitor returns to the page they were sent away from', async ({ page, request }) => {
    const user = await createUser(request)
    await page.goto('/?welcome=1')
    await expect(page).toHaveURL(/\/login$/)

    await page.getByLabel('Username or email').fill(user.username)
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/\?welcome=1$/)
  })

  test('the password can be revealed', async ({ page }) => {
    await page.goto('/login')
    const password = page.getByLabel('Password', { exact: true })
    await password.fill('secret-value')
    await expect(password).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(password).toHaveAttribute('type', 'text')
  })

  test('the login and register screens fit a phone', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true })
    const page = await context.newPage()
    await page.goto('/login')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true) // no sideways scrolling
    await page.screenshot(shot('auth-login-mobile'))
    await page.goto('/register')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await context.close()
  })
})

test.describe('email verification', () => {
  test('the emailed link verifies the address and the banner goes away', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user)
    await expect(page.getByRole('region', { name: 'Verify your email' })).toBeVisible()

    const link = await emailedLink(user.email, 'verify-email')
    await page.goto(link)
    await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
    await page.screenshot(shot('auth-email-verified'))

    await page.getByRole('link', { name: 'Go to your timeline' }).click()
    await expect(page.getByText(user.displayName).first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Verify your email' })).toBeHidden()

    // The token works once.
    await page.goto(link)
    await expect(page.getByRole('heading', { name: "We couldn't verify your email" })).toBeVisible()
  })

  test('the link also works for someone who is signed out (another device)', async ({ browser, request }) => {
    const user = await createUser(request)
    const link = await emailedLink(user.email, 'verify-email')
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto(link)

    await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
    await context.close()
  })

  test('"Resend email" sends a fresh link that works', async ({ page, request }) => {
    const user = await createUser(request)
    const first = await emailedLink(user.email, 'verify-email')
    await signIn(page, user)

    await page.getByRole('button', { name: 'Resend email' }).click()
    await expect(page.getByText(`We sent a new link to ${user.email}.`)).toBeVisible()

    const second = await emailedLink(user.email, 'verify-email', first)
    expect(second).not.toBe(first)
    await page.goto(second)
    await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible()
  })

  test('a made-up token is rejected', async ({ page }) => {
    await page.goto('/verify-email?token=definitely-not-valid')
    await expect(page.getByRole('heading', { name: "We couldn't verify your email" })).toBeVisible()
  })
})

test.describe('password reset', () => {
  test('forgot password -> emailed link -> new password; the old one stops working and other sessions end', async ({ page, request, browser }) => {
    const user = await createUser(request)
    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await signIn(otherPage, user)
    await expect(otherPage.getByText(user.displayName).first()).toBeVisible()

    await page.goto('/login')
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await page.getByLabel('Email', { exact: true }).fill(user.email)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByRole('status')).toContainText(`If an account exists for ${user.email}`)
    await page.screenshot(shot('auth-forgot-sent'))

    await page.goto(await emailedLink(user.email, 'reset-password'))
    await page.getByLabel('New password', { exact: true }).fill('brand-new-pass-1')
    await page.getByLabel('Confirm new password').fill('something-else-1')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByText("The passwords don't match")).toBeVisible()
    await page.getByLabel('Confirm new password').fill('brand-new-pass-1')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible()

    await login(page, user.username, 'password123')
    await expect(page.getByRole('alert')).toHaveText('Invalid credentials')
    await login(page, user.username, 'brand-new-pass-1')
    await expect(page.getByText(user.displayName).first()).toBeVisible()

    // Resetting the password signs the account out everywhere: the other browser's stored session is dead. (A tab that is already open keeps
    // its short-lived access token until that runs out, at most 15 minutes, so this models a tab opened afterwards: it has no access token and must refresh.)
    await otherPage.evaluate(() => sessionStorage.clear())
    await otherPage.reload()
    await expect(otherPage).toHaveURL(/\/login$/)
    await other.close()
  })

  test('an unknown email gets the same answer (no account enumeration)', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.getByLabel('Email', { exact: true }).fill(`nobody-${uniqueName()}@example.com`)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByRole('status')).toContainText('If an account exists for')
  })

  test('a bad or incomplete reset link is explained', async ({ page }) => {
    await page.goto('/reset-password?token=bogus')
    await page.getByLabel('New password', { exact: true }).fill('password123')
    await page.getByLabel('Confirm new password').fill('password123')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByRole('heading', { name: 'This link has expired' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible()

    await page.goto('/reset-password')
    await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible()
  })
})
