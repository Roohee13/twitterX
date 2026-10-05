import { expect, test, type Page } from '@playwright/test'
import { as, createUser, setLikeCount, shot, signIn, uniqueName } from './support'

// Posts here get 5 million likes so they outrank anything other specs left in the shared e2e database.
const POPULAR = 5_000_000

const home = (page: Page) => page.getByRole('tabpanel')
const tab = (page: Page, name: string) => page.getByRole('tab', { name })
const feedTexts = async (page: Page) => (await home(page).getByRole('article').locator('p').allTextContents()).filter((t) => t.startsWith('foryou '))

test.describe('For you', () => {
  test('a new account with no follows opens on For you and sees the popular posts of strangers', async ({ page, request }) => {
    const author = await createUser(request, { displayName: 'Pop Author' })
    const text = `foryou popular ${uniqueName()}`
    const post = await as(request, author).post(text)
    await setLikeCount([post.id], POPULAR)
    const newcomer = await createUser(request)

    await signIn(page, newcomer, '/', null) // no saved tab: the real default
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()

    await expect(tab(page, 'For you')).toHaveAttribute('aria-selected', 'true')
    await expect(home(page).getByText(text)).toBeVisible()
    await page.screenshot(shot('for-you-newcomer'))
    // The Following tab is still only the people you follow: nothing yet.
    await tab(page, 'Following').click()
    await expect(page.getByText('Your timeline is empty. Follow people to see their posts here.')).toBeVisible()
    await expect(home(page).getByText(text)).toHaveCount(0)
  })

  test('someone you follow ranks above an equally popular stranger, and the more popular post above the less popular', async ({ page, request }) => {
    const viewer = await createUser(request)
    const friend = await createUser(request, { displayName: 'Friend Fran' })
    const stranger = await createUser(request, { displayName: 'Stranger Sam' })
    const quiet = await createUser(request, { displayName: 'Quiet Quin' })
    await as(request, viewer).follow(friend.username)
    const tag = uniqueName()
    const strangerPost = await as(request, stranger).post(`foryou stranger ${tag}`)
    const quietPost = await as(request, quiet).post(`foryou quiet ${tag}`)
    const friendPost = await as(request, friend).post(`foryou friend ${tag}`)
    await setLikeCount([strangerPost.id, friendPost.id], POPULAR, { exclusive: true })
    await setLikeCount([quietPost.id], POPULAR / 5)

    await signIn(page, viewer, '/', 'for-you')

    await expect(home(page).getByText(`foryou quiet ${tag}`)).toBeVisible()
    const order = (await feedTexts(page)).filter((t) => t.endsWith(tag))
    expect(order).toEqual([`foryou friend ${tag}`, `foryou stranger ${tag}`, `foryou quiet ${tag}`])
  })

  test('posts you should not see are not there: blocked, muted, protected (until approved) and deleted', async ({ page, request }) => {
    const viewer = await createUser(request)
    const tag = uniqueName()
    const make = async (name: string) => {
      const user = await createUser(request, { displayName: name })
      const post = await as(request, user).post(`foryou ${name} ${tag}`)
      return { user, post }
    }
    const visible = await make('Visible')
    const blocked = await make('Blocked')
    const muted = await make('Muted')
    const secret = await make('Secret')
    const deleted = await make('Deleted')
    await as(request, viewer).block(blocked.user.username)
    await request.post(`/api/users/${muted.user.username}/mute`, { headers: { Authorization: `Bearer ${viewer.accessToken}` } })
    await as(request, secret.user).setProtected()
    await request.delete(`/api/posts/${deleted.post.id}`, { headers: { Authorization: `Bearer ${deleted.user.accessToken}` } })
    await setLikeCount([visible, blocked, muted, secret, deleted].map((x) => x.post.id), POPULAR)

    await signIn(page, viewer, '/', 'for-you')

    await expect(home(page).getByText(`foryou Visible ${tag}`)).toBeVisible()
    for (const name of ['Blocked', 'Muted', 'Secret', 'Deleted']) {
      await expect(home(page).getByText(`foryou ${name} ${tag}`)).toHaveCount(0)
    }

    // Once the owner approves you, the protected account's posts can appear.
    await as(request, viewer).requestFollow(secret.user.username)
    await as(request, secret.user).approve(viewer.username)
    await page.reload()
    await expect(home(page).getByText(`foryou Secret ${tag}`)).toBeVisible()
  })

  test('a like in For you is saved, and shows up on the Following tab too', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request, { displayName: 'Liked Author' })
    await as(request, viewer).follow(author.username)
    const text = `foryou like ${uniqueName()}`
    const post = await as(request, author).post(text)
    await setLikeCount([post.id], POPULAR)
    await signIn(page, viewer, '/', 'for-you')
    const card = home(page).getByRole('article').filter({ hasText: text })

    await card.getByRole('button', { name: 'Like' }).click()
    await expect(card.getByRole('button', { name: 'Unlike' })).toBeVisible()

    await tab(page, 'Following').click()
    const followingCard = home(page).getByRole('article').filter({ hasText: text })
    await expect(followingCard.getByRole('button', { name: 'Unlike' })).toBeVisible()
  })

  test('the tab you chose is remembered after a reload, and the arrow keys switch tabs', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user, '/', null)
    await expect(tab(page, 'For you')).toHaveAttribute('aria-selected', 'true')

    await tab(page, 'Following').click()
    await page.reload()
    await expect(tab(page, 'Following')).toHaveAttribute('aria-selected', 'true')

    await tab(page, 'Following').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(tab(page, 'For you')).toHaveAttribute('aria-selected', 'true')
    await expect(tab(page, 'For you')).toBeFocused()
  })

  test('a post you write shows at the top of the feed you are on at once', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user, '/', 'for-you')
    await expect(home(page).getByRole('article').first()).toBeVisible() // the feed has loaded, as it has when a person starts writing
    const text = `foryou mine ${uniqueName()}`

    await page.getByRole('textbox', { name: 'Post text' }).fill(text)
    await page.getByRole('button', { name: 'Post', exact: true }).first().click()

    await expect(home(page).getByRole('article').first()).toContainText(text)
  })

  test('scrolling loads the next page of the ranking without repeating anything', async ({ page, request }) => {
    test.setTimeout(120_000)
    const viewer = await createUser(request)
    const tag = uniqueName()
    const ids: number[] = []
    for (let i = 0; i < 26; i++) { // 26 different authors, so the per-author limit does not apply
      const author = await createUser(request)
      ids.push((await as(request, author).post(`foryou paging ${tag} ${String(i).padStart(2, '0')}`)).id)
    }
    await setLikeCount(ids, POPULAR)

    await signIn(page, viewer, '/', 'for-you')
    await expect(home(page).getByRole('article').first()).toBeVisible()
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, 4000)
      if ((await feedTexts(page)).filter((t) => t.includes(tag)).length >= 26) break
      await page.waitForTimeout(400)
    }

    const mine = (await feedTexts(page)).filter((t) => t.includes(tag))
    expect(mine).toHaveLength(26)
    expect(new Set(mine).size).toBe(26) // none twice
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } })

  test('the two tabs fit the screen', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user, '/', null)
    await expect(tab(page, 'For you')).toBeVisible()
    await expect(tab(page, 'Following')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('for-you-phone'))
  })
})
