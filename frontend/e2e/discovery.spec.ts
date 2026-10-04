import { expect, test, type Page } from '@playwright/test'
import { as, createUser, loginViaApi, shot, signIn } from './support'

const card = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text })
const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search', exact: true })

test.describe('search', () => {
  test('finds posts by their words, and people by name or @username', async ({ page, request }) => {
    const viewer = await createUser(request)
    const word = unique('zebraword')
    const author = await createUser(request, { displayName: `${word} Zed` })
    await as(request, author).post(`a post about ${word} today`)
    await as(request, author).post('an unrelated post')
    await signIn(page, viewer)

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Explore' }).click()
    await expect(page).toHaveURL(/\/explore$/)
    await searchBox(page).fill(word)

    await expect(page).toHaveURL(new RegExp(`q=${word}`))
    await expect(card(page, `about ${word}`)).toBeVisible()
    await expect(page.getByText('an unrelated post')).toHaveCount(0)
    await page.screenshot(shot('explore-results'))

    await page.getByRole('tab', { name: 'people' }).click()
    await expect(page.getByRole('link', { name: new RegExp(`${word} Zed`) })).toBeVisible() // names are matched from their start

    await searchBox(page).fill(`@${author.username.slice(0, 8)}`)
    await expect(page.getByRole('tab', { name: 'people' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('link', { name: new RegExp(`@${author.username}`) })).toBeVisible()
    await page.getByRole('link', { name: new RegExp(`@${author.username}`) }).click()
    await expect(page).toHaveURL(new RegExp(`/u/${author.username}$`))
  })

  test('a search can be shared as a link, and the box and tabs keep their state on reload', async ({ page, request }) => {
    const viewer = await createUser(request)
    const word = unique('linkword')
    await as(request, await createUser(request)).post(`findable ${word}`)

    await signIn(page, viewer, `/explore?q=${word}&tab=people`)

    await expect(searchBox(page)).toHaveValue(word)
    await expect(page.getByRole('tab', { name: 'people' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'posts' }).click()
    await expect(card(page, `findable ${word}`)).toBeVisible()
    await page.reload()
    await expect(page.getByRole('tab', { name: 'posts' })).toHaveAttribute('aria-selected', 'true')
    await expect(card(page, `findable ${word}`)).toBeVisible()
  })

  test('no matches, and a search that is too short, are explained', async ({ page, request }) => {
    await signIn(page, await createUser(request), '/explore')

    await searchBox(page).fill('a')
    await expect(page.getByText('Keep typing')).toBeVisible()

    await searchBox(page).fill('qqzzxxnothingmatchesthis')
    await expect(page.getByText('No posts match “qqzzxxnothingmatchesthis”')).toBeVisible()
    await page.getByRole('tab', { name: 'people' }).click()
    await expect(page.getByText('No people match “qqzzxxnothingmatchesthis”')).toBeVisible()

    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(page.getByRole('region', { name: 'Trending' })).toBeVisible()
  })

  test("a protected account's posts are not in anyone else's results, but are for approved followers", async ({ browser, page, request }) => {
    const viewer = await createUser(request)
    const priv = await createUser(request)
    const word = unique('secretword')
    await as(request, priv).setProtected()
    await as(request, priv).post(`guarded ${word}`)
    await signIn(page, viewer, `/explore?q=${word}`)
    await expect(page.getByText(`No posts match “${word}”`)).toBeVisible()

    await as(request, viewer).follow(priv.username)
    await as(request, priv).approve(viewer.username)
    const approved = await browser.newContext()
    const approvedPage = await approved.newPage()
    await signIn(approvedPage, await loginViaApi(request, viewer), `/explore?q=${word}`) // the first browser already spent registration's token
    await expect(card(approvedPage, `guarded ${word}`)).toBeVisible()
    await approved.close()
  })

  test('the small search box beside the page opens Explore with the search', async ({ page, request }) => {
    const word = unique('sidebox')
    await as(request, await createUser(request)).post(`from the side ${word}`)
    await signIn(page, await createUser(request))

    await page.getByRole('searchbox', { name: 'Search XClone' }).fill(word)
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(new RegExp(`/explore\\?q=${word}`))
    await expect(card(page, `from the side ${word}`)).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search XClone' })).toHaveCount(0) // Explore has its own
  })
})

test.describe('hashtags and trends', () => {
  test('clicking a hashtag lists every post using it, leaving out protected accounts', async ({ page, request }) => {
    const viewer = await createUser(request)
    const tag = unique('tagpage')
    const a = await createUser(request, { displayName: 'Ann Author' })
    const b = await createUser(request, { displayName: 'Bea Writer' })
    const priv = await createUser(request)
    await as(request, priv).setProtected()
    await as(request, a).post(`first post #${tag}`)
    await as(request, b).post(`second post #${tag}`)
    await as(request, priv).post(`guarded post #${tag}`)
    await as(request, viewer).follow(a.username)
    await signIn(page, viewer)

    await card(page, `first post #${tag}`).getByRole('link', { name: `#${tag}` }).click()

    await expect(page).toHaveURL(new RegExp(`/hashtag/${tag}$`))
    await expect(page.getByRole('heading', { name: `#${tag}` })).toBeVisible()
    await expect(page.getByRole('article')).toHaveCount(2)
    await expect(card(page, 'second post')).toBeVisible()
    await expect(page.getByText('guarded post')).toHaveCount(0)
    const order = await page.getByRole('article').allTextContents()
    expect(order[0]).toContain('second post') // newest first
    await page.screenshot(shot('hashtag-page'))
  })

  test('an unused tag has an empty page', async ({ page, request }) => {
    await signIn(page, await createUser(request), `/hashtag/${unique('nobodyusedthis')}`)
    await expect(page.getByText(/^No posts with #.+ yet$/)).toBeVisible()
  })

  test('a popular tag shows up in the side panel and on Explore, and leads to its page', async ({ page, request }) => {
    const tag = unique('trendy')
    const people = [await createUser(request), await createUser(request), await createUser(request)]
    for (const person of people) await as(request, person).post(`join in #${tag}`)
    // Which tags make the short list depends on every post ever made in the shared test database, so the list itself is stubbed
    // (the ranking has its own backend tests). The posts behind the tag, and the page it leads to, are real.
    await page.route('**/api/trending/hashtags*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ name: tag, postCount: 3, userCount: 3 }]) }))
    await signIn(page, await createUser(request))

    const panel = page.getByRole('region', { name: 'Trends' })
    await expect(panel.getByRole('link', { name: new RegExp(`#${tag}`) })).toBeVisible()
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Explore' }).click()
    const explore = page.getByRole('region', { name: 'Trending' })
    await expect(explore.getByRole('link', { name: new RegExp(`#${tag}.*3 posts · 3 people`) })).toBeVisible()
    await page.screenshot(shot('explore-browse'))

    await explore.getByRole('link', { name: new RegExp(`#${tag}`) }).click()
    await expect(page).toHaveURL(new RegExp(`/hashtag/${tag}$`))
    await expect(page.getByRole('article')).toHaveCount(3)
  })
})

test.describe('who to follow', () => {
  test('suggests friends of friends, and following one puts their posts in your timeline', async ({ page, request }) => {
    const viewer = await createUser(request)
    const friend = await createUser(request, { displayName: 'Fiona Friend' })
    const stranger = await createUser(request, { displayName: 'Sam Suggested' })
    await as(request, viewer).follow(friend.username)
    await as(request, friend).follow(stranger.username)
    await as(request, stranger).post('a post from a suggested person')
    await signIn(page, viewer)

    // Accounts from earlier test runs share display names, so people are found by username.
    const panel = page.getByRole('region', { name: 'Who to follow' })
    const suggested = panel.getByRole('link', { name: new RegExp(`@${stranger.username}`) })
    await expect(suggested).toContainText('Followed by 1 person you follow')
    await expect(panel.getByRole('button', { name: `Follow @${friend.username}` })).toHaveCount(0) // already followed
    await page.screenshot(shot('who-to-follow'))

    await panel.getByRole('button', { name: `Follow @${stranger.username}` }).click()
    await expect(panel.getByText('Following')).toBeVisible()
    await expect(card(page, 'a post from a suggested person')).toBeVisible() // the timeline refreshed

    await page.reload()
    await expect(page.getByRole('region', { name: 'Who to follow' }).getByRole('link', { name: new RegExp(`@${stranger.username}`) })).toHaveCount(0)
  })

  test('a protected suggestion becomes a request', async ({ page, request }) => {
    const viewer = await createUser(request)
    const friend = await createUser(request)
    const priv = await createUser(request, { displayName: 'Pat Private' })
    await as(request, priv).setProtected()
    await as(request, viewer).follow(friend.username)
    await as(request, friend).follow(priv.username) // a request that the owner has not answered counts as no follow...
    await as(request, priv).approve(friend.username) // ...so approve it to make Pat a friend of a friend
    await signIn(page, viewer)

    const panel = page.getByRole('region', { name: 'Who to follow' })
    const row = panel.getByRole('link', { name: new RegExp(`@${priv.username}`) })
    await expect(row.getByLabel('Protected account')).toBeVisible()
    await panel.getByRole('button', { name: `Follow @${priv.username}` }).click()

    await expect(panel.getByText('Requested')).toBeVisible()
    await page.goto(`/u/${priv.username}`)
    await expect(page.getByRole('button', { name: `Withdraw follow request to @${priv.username}` })).toBeVisible()
  })

  test('a brand-new account still gets suggestions, and Explore lists more of them', async ({ page, request }) => {
    await signIn(page, await createUser(request))
    await expect(page.getByRole('region', { name: 'Who to follow' })).toBeVisible()

    await page.getByRole('region', { name: 'Who to follow' }).getByRole('link', { name: 'Show more' }).click()

    await expect(page).toHaveURL(/\/explore$/)
    await expect(page.getByRole('region', { name: 'Who to follow' }).first()).toBeVisible()
  })
})

test.describe('bookmarks', () => {
  test('saved posts are listed newest-saved first, can be removed on the spot, and are remembered', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request)
    await as(request, viewer).follow(author.username)
    const first = await as(request, author).post('bookmark number one')
    const second = await as(request, author).post('bookmark number two')
    await as(request, author).post('never bookmarked')
    await signIn(page, viewer)

    await card(page, 'bookmark number one').getByRole('button', { name: 'Bookmark', exact: true }).click()
    await expect(card(page, 'bookmark number one').getByRole('button', { name: 'Remove bookmark' })).toBeVisible()
    await card(page, 'bookmark number two').getByRole('button', { name: 'Bookmark', exact: true }).click()
    await expect(card(page, 'bookmark number two').getByRole('button', { name: 'Remove bookmark' })).toBeVisible()

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Bookmarks' }).click()
    await expect(page).toHaveURL(/\/bookmarks$/)
    await expect(page.getByRole('article')).toHaveCount(2)
    const order = await page.getByRole('article').allTextContents()
    expect(order[0]).toContain('bookmark number two') // saved last, shown first
    expect(order[1]).toContain('bookmark number one')
    await expect(page.getByText('never bookmarked')).toHaveCount(0)
    await page.screenshot(shot('bookmarks'))

    await card(page, 'bookmark number two').getByRole('button', { name: 'Remove bookmark' }).click()
    await expect(page.getByText('bookmark number two')).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('article')).toHaveCount(1)
    await expect(card(page, 'bookmark number one')).toBeVisible()
    void first
    void second
  })

  test('with nothing saved it invites you to save posts', async ({ page, request }) => {
    await signIn(page, await createUser(request), '/bookmarks')
    await expect(page.getByText('Save posts for later')).toBeVisible()
  })

  test("a post that was bookmarked and then deleted by its author is simply gone", async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request)
    const post = await as(request, author).post('here and then gone')
    await as(request, viewer).bookmark(post.id)
    await request.delete(`/api/posts/${post.id}`, { headers: { Authorization: `Bearer ${author.accessToken}` } })
    await signIn(page, viewer, '/bookmarks')
    await expect(page.getByText('Save posts for later')).toBeVisible()
  })
})

test.describe('on a phone', () => {
  test('Explore, results and Bookmarks fit, and the bottom bar reaches them', async ({ browser, request }) => {
    const viewer = await createUser(request)
    const word = unique('phoneword')
    await as(request, await createUser(request)).post(`phone search ${word} ${'longword'.repeat(12)}`)
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true })
    const page = await context.newPage()
    await signIn(page, viewer)

    const bar = page.getByRole('navigation', { name: 'Main (mobile)' })
    await bar.getByRole('link', { name: 'Explore' }).click()
    await searchBox(page).fill(word)
    await expect(page.getByRole('article')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('explore-mobile'))

    await bar.getByRole('link', { name: 'Bookmarks' }).click()
    await expect(page.getByText('Save posts for later')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await context.close()
  })
})
