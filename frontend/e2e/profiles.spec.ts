import { expect, test, type Browser, type Page } from '@playwright/test'
import { as, createUser, shot, signIn, type TestUser } from './support'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const card = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text })

/** A second signed-in browser, for the other person in a two-person flow. */
async function sessionFor(browser: Browser, user: TestUser, path = '/') {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, user, path)
  return { context, page }
}

test.describe('the profile page', () => {
  test('shows the person, their bio and counts, and a tab for posts, replies and likes', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request, { displayName: 'Ben Builder' })
    const other = await createUser(request, { displayName: 'Olive Other' })
    await as(request, ben).updateProfile({ bio: 'Builds things #diy and shares https://example.com/work' })
    const mine = await as(request, ben).post('ben original post')
    const theirs = await as(request, other).post('olive says hello')
    await as(request, ben).reply(theirs.id, 'ben replying to olive')
    await as(request, ben).like(theirs.id)
    await as(request, other).follow(ben.username)
    await as(request, viewer).follow(ben.username)
    await signIn(page, viewer, `/u/${ben.username}`)

    await expect(page.getByRole('heading', { name: 'Ben Builder', level: 2 })).toBeVisible()
    await expect(page.getByText(`@${ben.username}`).first()).toBeVisible()
    await expect(page.getByRole('link', { name: '#diy' }).first()).toHaveAttribute('href', '/hashtag/diy')
    await expect(page.getByRole('link', { name: 'example.com/work' })).toHaveAttribute('target', '_blank')
    await expect(page.getByText(/^Joined \w+ \d{4}$/)).toBeVisible()
    await expect(page.getByRole('link', { name: '2 Followers' })).toBeVisible()
    await expect(card(page, 'ben original post')).toBeVisible()
    await page.screenshot(shot('profile-desktop'))

    await page.getByRole('tab', { name: 'Replies' }).click()
    await expect(page).toHaveURL(/tab=replies$/)
    await expect(card(page, 'ben replying to olive')).toBeVisible()
    await expect(page.getByText('ben original post')).toHaveCount(0)

    await page.getByRole('tab', { name: 'Likes' }).click()
    await expect(card(page, 'olive says hello')).toBeVisible()

    await page.reload() // the tab is in the address, so it survives a reload
    await expect(page.getByRole('tab', { name: 'Likes' })).toHaveAttribute('aria-selected', 'true')
    void mine
  })

  test('your own profile has an Edit button and friendly empty tabs; the nav link finds it', async ({ page, request }) => {
    const user = await createUser(request, { displayName: 'Nina New' })
    await signIn(page, user)

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Profile' }).click()

    await expect(page).toHaveURL(new RegExp(`/u/${user.username}$`))
    await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Follow/ })).toHaveCount(0)
    await expect(page.getByText("You haven't posted yet")).toBeVisible()
  })

  test('names and pictures in the timeline lead to the profile', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request, { displayName: 'Ben Builder' })
    await as(request, viewer).follow(ben.username)
    await as(request, ben).post('click my name')
    await signIn(page, viewer)

    await page.getByRole('article').getByRole('link', { name: 'Ben Builder' }).click()

    await expect(page).toHaveURL(new RegExp(`/u/${ben.username}$`))
    await expect(page.getByRole('heading', { name: 'Ben Builder', level: 2 })).toBeVisible()
  })

  test('an account that does not exist', async ({ page, request }) => {
    await signIn(page, await createUser(request), '/u/nobody_here_xyz')
    await expect(page.getByText("This account doesn't exist")).toBeVisible()
  })

  test('with banner and avatar pictures (storage mocked)', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request, { displayName: 'Ben Builder' })
    await as(request, ben).post('a post under a pretty header')
    await as(request, viewer).follow(ben.username)
    await page.route('https://media.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await page.route(`**/api/users/${ben.username}`, async (route) => {
      const real = await route.fetch()
      const profile = await real.json()
      return route.fulfill({ response: real, json: { ...profile, bannerUrl: 'https://media.test/banner.png', avatarUrl: 'https://media.test/avatar.png', bio: 'Pictures are mocked here.' } })
    })

    await signIn(page, viewer, `/u/${ben.username}`)

    await expect(page.locator('header img').first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => [...document.images].filter((i) => i.src.includes('media.test') && i.naturalWidth > 0).length)).toBeGreaterThanOrEqual(2)
    await page.screenshot(shot('profile-with-pictures'))
  })
})

test.describe('following', () => {
  test('follow, see their posts in the timeline, and unfollow after confirming', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request, { displayName: 'Ben Builder' })
    await as(request, ben).post('a post worth following')
    await signIn(page, viewer, `/u/${ben.username}`)
    await expect(page.getByRole('link', { name: '0 Followers' })).toBeVisible()

    await page.getByRole('button', { name: `Follow @${ben.username}` }).click()
    await expect(page.getByRole('button', { name: `Unfollow @${ben.username}` })).toHaveText('Following')
    await expect(page.getByRole('link', { name: '1 Follower' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('button', { name: `Unfollow @${ben.username}` })).toBeVisible() // the server remembers
    await page.goto('/')
    await expect(card(page, 'a post worth following')).toBeVisible() // and the timeline follows suit

    await page.goto(`/u/${ben.username}`)
    await page.getByRole('button', { name: `Unfollow @${ben.username}` }).click()
    await page.screenshot(shot('profile-unfollow-dialog'))
    await page.getByRole('dialog').getByRole('button', { name: 'Unfollow' }).click()
    await expect(page.getByRole('button', { name: `Follow @${ben.username}` })).toBeVisible()
    await page.goto('/')
    await expect(page.getByText('a post worth following')).toHaveCount(0)
  })

  test('followers and following lists', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request, { displayName: 'Ben Builder' })
    const fan = await createUser(request, { displayName: 'Fanny Fan' })
    const star = await createUser(request, { displayName: 'Stella Star' })
    await as(request, fan).follow(ben.username)
    await as(request, ben).follow(star.username)
    await signIn(page, viewer, `/u/${ben.username}`)

    await page.getByRole('link', { name: '1 Follower' }).click()
    await expect(page).toHaveURL(new RegExp(`/u/${ben.username}/followers$`))
    await expect(page.getByRole('link', { name: /Fanny Fan/ })).toBeVisible()
    await page.getByRole('navigation', { name: 'Followers and following' }).getByRole('link', { name: 'Following' }).click()
    await expect(page.getByRole('link', { name: /Stella Star/ })).toBeVisible()
    await page.getByRole('link', { name: /Stella Star/ }).click()
    await expect(page).toHaveURL(new RegExp(`/u/${star.username}$`))
  })
})

test.describe('protected accounts', () => {
  test('ask to follow, get approved by the owner, then see the posts', async ({ browser, request }) => {
    const owner = await createUser(request, { displayName: 'Paula Private' })
    const fan = await createUser(request, { displayName: 'Fred Fan' })
    await as(request, owner).setProtected()
    await as(request, owner).post('only my approved followers see this')
    const ownerSession = await sessionFor(browser, owner)
    const fanSession = await sessionFor(browser, fan, `/u/${owner.username}`)

    // The visitor sees a lock screen, not posts, and can ask to follow.
    await expect(fanSession.page.getByText('These posts are protected')).toBeVisible()
    await expect(fanSession.page.getByLabel('Protected account').first()).toBeVisible()
    await fanSession.page.screenshot(shot('protected-locked'))
    await fanSession.page.getByRole('button', { name: `Follow @${owner.username}` }).click()
    const requested = fanSession.page.getByRole('button', { name: `Withdraw follow request to @${owner.username}` })
    await expect(requested).toHaveText('Requested')
    await expect(fanSession.page.getByText(/Your request is waiting/)).toBeVisible()

    // The owner finds it in the inbox (the nav link only exists for protected accounts) and approves.
    await ownerSession.page.reload()
    await ownerSession.page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Follow requests' }).click()
    await expect(ownerSession.page.getByText('Fred Fan')).toBeVisible()
    await ownerSession.page.screenshot(shot('protected-inbox'))
    await ownerSession.page.getByRole('button', { name: 'Approve Fred Fan' }).click()
    await expect(ownerSession.page.getByText('No pending requests')).toBeVisible()

    // Now the visitor is a follower and sees the posts.
    await fanSession.page.reload()
    await expect(fanSession.page.getByRole('button', { name: `Unfollow @${owner.username}` })).toBeVisible()
    await expect(card(fanSession.page, 'only my approved followers see this')).toBeVisible()
    await expect(fanSession.page.getByText('These posts are protected')).toHaveCount(0)
    await ownerSession.context.close()
    await fanSession.context.close()
  })

  test('a denied request leaves the visitor locked out, and a withdrawn one disappears from the inbox', async ({ browser, request }) => {
    const owner = await createUser(request, { displayName: 'Paula Private' })
    const denied = await createUser(request, { displayName: 'Dora Denied' })
    const withdrawer = await createUser(request, { displayName: 'Wendy Withdraws' })
    await as(request, owner).setProtected()
    await as(request, owner).post('guarded words')
    await as(request, denied).requestFollow(owner.username)
    await as(request, withdrawer).requestFollow(owner.username)
    const ownerSession = await sessionFor(browser, owner, '/follow-requests')
    await expect(ownerSession.page.getByText('Dora Denied')).toBeVisible()
    await expect(ownerSession.page.getByText('Wendy Withdraws')).toBeVisible()

    await ownerSession.page.getByRole('button', { name: 'Deny Dora Denied' }).click()
    await expect(ownerSession.page.getByText('Request from @' + denied.username + ' denied.')).toBeVisible()
    await expect(ownerSession.page.getByText('Dora Denied')).toHaveCount(0)

    const deniedSession = await sessionFor(browser, denied, `/u/${owner.username}`)
    await expect(deniedSession.page.getByText('These posts are protected')).toBeVisible()
    await expect(deniedSession.page.getByRole('button', { name: `Follow @${owner.username}` })).toBeVisible() // may ask again

    const withdrawSession = await sessionFor(browser, withdrawer, `/u/${owner.username}`)
    await withdrawSession.page.getByRole('button', { name: `Withdraw follow request to @${owner.username}` }).click()
    await expect(withdrawSession.page.getByRole('button', { name: `Follow @${owner.username}` })).toBeVisible()
    await ownerSession.page.reload()
    await expect(ownerSession.page.getByText('No pending requests')).toBeVisible()
    for (const s of [ownerSession, deniedSession, withdrawSession]) await s.context.close()
  })

  test('an account that is not protected has no follow-requests link', async ({ page, request }) => {
    await signIn(page, await createUser(request))
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Follow requests' })).toHaveCount(0)
  })

  test("a protected account's lists are hidden from strangers", async ({ page, request }) => {
    const owner = await createUser(request)
    await as(request, owner).setProtected()
    await signIn(page, await createUser(request), `/u/${owner.username}/followers`)
    await expect(page.getByText("You can't see this list")).toBeVisible()
  })
})

test.describe('blocking, muting and reporting', () => {
  test('block asks first, hides the account, and can be undone from the notice', async ({ browser, page, request }) => {
    const viewer = await createUser(request, { displayName: 'Vera Viewer' })
    const ben = await createUser(request, { displayName: 'Ben Builder' })
    await as(request, viewer).follow(ben.username)
    await as(request, ben).post('ben before the block')
    await as(request, viewer).post('vera post that ben will not see')
    await signIn(page, viewer, `/u/${ben.username}`)
    await expect(card(page, 'ben before the block')).toBeVisible()

    await page.getByRole('button', { name: 'Profile actions' }).click()
    await page.getByRole('menuitem', { name: `Block @${ben.username}` }).click()
    const dialog = page.getByRole('dialog', { name: `Block @${ben.username}?` })
    await expect(dialog).toContainText('You will stop following each other')
    await page.screenshot(shot('profile-block-dialog'))
    await dialog.getByRole('button', { name: 'Block' }).click()

    await expect(page.getByText(`You blocked @${ben.username}`)).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(page.getByRole('button', { name: `Unblock @${ben.username}` }).first()).toHaveText('Blocked')
    await page.goto('/')
    await expect(page.getByText('ben before the block')).toHaveCount(0)

    // From Ben's side, Vera's posts are off limits.
    const benSession = await sessionFor(browser, ben, `/u/${viewer.username}`)
    await expect(benSession.page.getByText("You can't see these posts")).toBeVisible()
    await benSession.context.close()

    await page.goto(`/u/${ben.username}`)
    await page.getByRole('button', { name: 'Unblock', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Posts' })).toBeVisible()
    await expect(page.getByRole('button', { name: `Follow @${ben.username}` })).toBeVisible() // blocking removed the follow
  })

  test('muting keeps the account visible but quiets its posts in your timeline', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request, { displayName: 'Ben Builder' })
    await as(request, viewer).follow(ben.username)
    await as(request, ben).post('ben is chatty')
    await signIn(page, viewer, '/')
    await expect(card(page, 'ben is chatty')).toBeVisible()

    await page.goto(`/u/${ben.username}`)
    await page.getByRole('button', { name: 'Profile actions' }).click()
    await page.getByRole('menuitem', { name: `Mute @${ben.username}` }).click()
    await expect(page.getByText(/Muted @.+\. You won't see their posts or notifications\./)).toBeVisible()
    await expect(page.getByText('Muted', { exact: true })).toBeVisible()
    await expect(card(page, 'ben is chatty')).toBeVisible() // their own page still works

    await page.goto('/')
    await expect(page.getByText('ben is chatty')).toHaveCount(0)

    await page.goto(`/u/${ben.username}`)
    await page.getByRole('button', { name: 'Profile actions' }).click()
    await page.getByRole('menuitem', { name: `Unmute @${ben.username}` }).click()
    await page.goto('/')
    await expect(card(page, 'ben is chatty')).toBeVisible()
  })

  test('reporting an account asks for a reason and handles a repeat calmly', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request)
    await signIn(page, viewer, `/u/${ben.username}`)

    for (const expected of [/Thanks for letting us know/, 'You already reported this account.']) {
      await page.getByRole('button', { name: 'Profile actions' }).click()
      await page.getByRole('menuitem', { name: `Report @${ben.username}` }).click()
      const dialog = page.getByRole('dialog', { name: `Report @${ben.username}` })
      await expect(dialog.getByRole('button', { name: 'Report' })).toBeDisabled()
      await dialog.getByLabel("It's spam").check()
      await dialog.getByRole('button', { name: 'Report' }).click()
      await expect(page.getByText(expected)).toBeVisible()
      await expect(dialog).toBeHidden()
    }
  })
})

test.describe('editing your profile', () => {
  test('name and bio are saved, shown at once, and remembered', async ({ page, request }) => {
    const user = await createUser(request, { displayName: 'Old Name' })
    await as(request, user).post('a post by me')
    await signIn(page, user, `/u/${user.username}`)

    await page.getByRole('button', { name: 'Edit profile' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit profile' })
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    await dialog.getByLabel('Name', { exact: true }).fill('New Name')
    await dialog.getByLabel('Bio').fill('I like #testing')
    await page.screenshot(shot('profile-edit-dialog'))
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Your profile was updated.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'New Name', level: 2 })).toBeVisible()
    await expect(page.getByRole('link', { name: '#testing' }).first()).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Main' }).locator('..').getByText('New Name').first()).toBeVisible() // the side card
    await page.reload()
    await expect(page.getByRole('heading', { name: 'New Name', level: 2 })).toBeVisible()
    await expect(card(page, 'a post by me')).toContainText('New Name')
  })

  test('empty names and long bios are stopped before saving', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user, `/u/${user.username}`)
    await page.getByRole('button', { name: 'Edit profile' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit profile' })

    await dialog.getByLabel('Name', { exact: true }).fill('')
    await expect(dialog.getByText('Enter a name')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    await dialog.getByLabel('Name', { exact: true }).fill('Fine')
    await dialog.getByLabel('Bio').fill('x'.repeat(161))
    await expect(dialog.getByLabel('1 characters over the limit')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('pictures: previews and the keys sent to the server (storage mocked)', async ({ page, request }) => {
    const user = await createUser(request)
    let n = 0
    await page.route('**/api/media/upload-url', (route) => {
      n += 1
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ key: `users/${user.id}/pic${n}.png`, uploadUrl: `https://r2.test/pic${n}`, headers: { 'content-type': ['image/png'] }, publicUrl: `https://media.test/pic${n}.png`, expiresAt: '2031-01-01T00:00:00Z' }) })
    })
    await page.route('https://r2.test/**', (route) => route.fulfill({ status: 200 }))
    let sent: Record<string, unknown> | undefined
    await page.route('**/api/users/me', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      sent = route.request().postDataJSON()
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: user.id, username: user.username, email: user.email, emailVerified: false, displayName: user.displayName, bio: null, avatarUrl: 'https://media.test/pic1.png', bannerUrl: 'https://media.test/pic2.png', createdAt: new Date().toISOString(), protectedAccount: false }) })
    })
    await signIn(page, user, `/u/${user.username}`)

    await page.getByRole('button', { name: 'Edit profile' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit profile' })
    await dialog.getByLabel('Choose profile photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
    await dialog.getByLabel('Choose banner').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: PNG })
    await expect(dialog.getByAltText('Banner preview')).toBeVisible()
    await expect(dialog.getByRole('progressbar')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Your profile was updated.')).toBeVisible()
    expect(sent).toEqual({ avatarKey: `users/${user.id}/pic1.png`, bannerKey: `users/${user.id}/pic2.png` })
  })

  test('without image storage a picture is refused with the reason (real backend)', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user, `/u/${user.username}`)
    await page.getByRole('button', { name: 'Edit profile' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit profile' })

    await dialog.getByLabel('Choose profile photo').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })

    await expect(dialog.getByText('Image uploads are not set up on this server yet.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

test.describe('on a phone', () => {
  test('the profile page, its menu and the edit dialog fit the screen', async ({ browser, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request, { displayName: 'Ben Builder With A Rather Long Display Name' })
    await as(request, ben).updateProfile({ bio: 'A bio with a long unbroken word: ' + 'supercalifragilistic'.repeat(3) })
    await as(request, viewer).follow(ben.username)
    await as(request, ben).post('profile on a small screen')
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true })
    const page = await context.newPage()
    await signIn(page, viewer, `/u/${ben.username}`)

    await expect(card(page, 'profile on a small screen')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('profile-mobile'))
    await expect(page.getByRole('navigation', { name: 'Main (mobile)' }).getByRole('link', { name: 'Profile' })).toBeVisible()

    await page.goto(`/u/${viewer.username}`)
    await page.getByRole('button', { name: 'Edit profile' }).click()
    await expect(page.getByRole('dialog', { name: 'Edit profile' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('profile-edit-mobile'))
    await context.close()
  })
})
