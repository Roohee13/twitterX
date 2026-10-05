import { expect, test, type Page } from '@playwright/test'
import { as, createUser, setLikeCount, shot, signIn, uniqueName } from './support'

const main = (page: Page) => page.getByRole('main')

/** Alice builds up a full footprint, then deactivates in Settings. Bob (who follows her, replied-to by her, and messaged with her) looks at what is left. */
async function aliceDeactivates(browser: import('@playwright/test').Browser, request: Parameters<typeof createUser>[0]) {
  const alice = await createUser(request, { displayName: 'Alice Ghost' })
  const bob = await createUser(request, { displayName: 'Bob Watcher' })
  const tag = uniqueName()
  const aliceApi = as(request, alice)
  const bobApi = as(request, bob)
  await aliceApi.updateProfile({ bio: `alice private bio ${tag}` })
  const alicePost = await aliceApi.post(`alicepost #${tag} words${tag}`)
  const bobPost = await bobApi.post(`bob asks ${tag}`)
  await aliceApi.reply(bobPost.id, `alice answers ${tag}`)
  await bobApi.follow(alice.username)
  await aliceApi.follow(bob.username)
  await aliceApi.like(bobPost.id)
  await setLikeCount([alicePost.id], 5_000_000) // so For you would certainly show it
  const conv = await bobApi.startConversation(alice.username)
  await aliceApi.sendMessage(conv.id, 'hello from alice before she left')
  await bobApi.sendMessage(conv.id, 'bob answers alice')

  const alicePage = await (await browser.newContext()).newPage()
  await signIn(alicePage, alice, '/settings')
  await alicePage.getByRole('button', { name: 'Deactivate', exact: true }).click()
  await alicePage.getByRole('dialog', { name: 'Deactivate your account?' }).getByRole('button', { name: 'Deactivate' }).click()
  await expect(alicePage).toHaveURL(/\/login/)
  return { alice, bob, tag, alicePost, bobPost, conv, alicePage }
}

test.describe('deactivated accounts', () => {
  test('after Alice deactivates, Bob sees a blank "XClone user" and none of her posts, anywhere', async ({ browser, page, request }) => {
    test.setTimeout(120_000)
    const { alice, bob, tag, bobPost } = await aliceDeactivates(browser, request)

    // Her profile address: the name "XClone user" and nothing of hers.
    await signIn(page, bob, `/u/${alice.username}`)
    await expect(main(page).getByRole('heading', { name: 'XClone user', level: 2 })).toBeVisible()
    await expect(page.getByText('This account is unavailable.')).toBeVisible()
    await expect(main(page)).not.toContainText(alice.username)
    await expect(main(page)).not.toContainText('Alice Ghost')
    await expect(main(page)).not.toContainText('alice private bio')
    const blank = page.getByRole('region', { name: 'Unavailable account' }) // (the page also has the verify-your-email banner above it)
    await expect(blank.getByRole('tab')).toHaveCount(0)
    await expect(blank.getByRole('button')).toHaveCount(0)
    await expect(blank.getByRole('link')).toHaveCount(0)
    await page.screenshot(shot('deactivated-profile'))

    // Her posts are in neither Home feed.
    await page.goto('/')
    await expect(page.getByRole('tab', { name: 'Following' })).toBeVisible()
    await expect(page.getByText(`bob asks ${tag}`)).toBeVisible() // Bob's own post is there: the page has loaded
    await expect(page.getByText(`alicepost #${tag}`)).toHaveCount(0)
    await page.getByRole('tab', { name: 'For you' }).click()
    await expect(page.getByRole('tabpanel').getByRole('article').first()).toBeVisible()
    await expect(page.getByText(`alicepost #${tag}`)).toHaveCount(0)

    // Not in search, not on the hashtag page, not as a reply under Bob's post.
    await page.goto(`/explore?q=words${tag}`)
    await expect(page.getByText('Alice Ghost')).toHaveCount(0)
    await expect(page.getByText(`alicepost #${tag}`)).toHaveCount(0)
    await page.goto(`/hashtag/${tag}`)
    await expect(page.getByText(`alicepost #${tag}`)).toHaveCount(0)
    await page.goto(`/explore?q=${alice.username}&tab=people`)
    await expect(page.getByText('Alice Ghost')).toHaveCount(0)
    await page.goto(`/post/${bobPost.id}`)
    await expect(page.getByText(`bob asks ${tag}`)).toBeVisible()
    await expect(page.getByText(`alice answers ${tag}`)).toHaveCount(0)

    // In Bob's following list she is a plain "XClone user" row with nothing to open.
    await page.goto(`/u/${bob.username}/following`)
    const row = page.getByText('XClone user', { exact: true })
    await expect(row).toBeVisible()
    await expect(page.getByText('Alice Ghost')).toHaveCount(0)
    expect(await row.evaluate((el) => !!el.closest('a'))).toBe(false)
    await page.screenshot(shot('deactivated-following-list'))
  })

  test('the conversation stays: readable, shown as "XClone user", and impossible to write in', async ({ browser, page, request }) => {
    test.setTimeout(120_000)
    const { alice, bob, conv } = await aliceDeactivates(browser, request)
    await signIn(page, bob, '/messages')

    const row = page.getByRole('link', { name: /Conversation with XClone user/ })
    await expect(row).toBeVisible()
    await expect(row).not.toContainText(alice.username)
    await row.click()

    await expect(page).toHaveURL(new RegExp(`/messages/${conv.id}$`))
    await expect(page.getByText('hello from alice before she left')).toBeVisible()
    await expect(page.getByText('bob answers alice')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'XClone user', level: 1 })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: "You can't reply to this conversation" })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Message actions' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /profile/ })).toHaveCount(0)
    await page.screenshot(shot('deactivated-chat'))
    // The server agrees: no writing.
    const send = await request.post(`/api/conversations/${conv.id}/messages`, { headers: { Authorization: `Bearer ${bob.accessToken}` }, data: { content: 'anyone?' } })
    expect(send.status()).toBe(403)
  })

  test('signing in again brings everything back', async ({ browser, page, request }) => {
    test.setTimeout(120_000)
    const { alice, bob, tag, alicePage } = await aliceDeactivates(browser, request)
    await signIn(page, bob, `/u/${alice.username}`)
    await expect(page.getByText('This account is unavailable.')).toBeVisible()

    await alicePage.getByLabel('Username or email').fill(alice.username)
    await alicePage.getByLabel('Password', { exact: true }).fill(alice.password)
    await alicePage.getByRole('button', { name: 'Sign in' }).click()
    await expect(alicePage.getByRole('navigation', { name: 'Main' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Alice Ghost', level: 2 })).toBeVisible()
    await expect(page.getByText(`alice private bio ${tag}`)).toBeVisible()
    await expect(page.getByText(`alicepost #${tag}`)).toBeVisible()
    await page.goto('/')
    await expect(page.getByText(`alicepost #${tag}`)).toBeVisible() // back in Following
    await page.goto(`/u/${bob.username}/following`)
    await expect(page.getByText('Alice Ghost')).toBeVisible()
    await expect(page.getByText('XClone user', { exact: true })).toHaveCount(0)
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } })

  test('the blank profile fits the screen', async ({ browser, page, request }) => {
    test.setTimeout(120_000)
    const { alice, bob } = await aliceDeactivates(browser, request)
    await signIn(page, bob, `/u/${alice.username}`)
    await expect(page.getByText('This account is unavailable.')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('deactivated-phone'))
  })
})
