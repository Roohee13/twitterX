import { expect, test } from '@playwright/test'
import { as, createUser, shot, signIn, uniqueName } from './support'

// A 1x1 PNG, served for every image the mocked posts point at.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test.describe('home timeline', () => {
  test('shows posts from followed accounts: links, quotes, reposts, protected authors; hides everyone else', async ({ page, request }) => {
    const viewer = await createUser(request, { displayName: 'Vera Viewer' })
    const ben = await createUser(request, { displayName: 'Ben Builder' })
    const cleo = await createUser(request, { displayName: 'Cleo Stranger' })
    const dana = await createUser(request, { displayName: 'Dana Private' })
    const v = as(request, viewer), b = as(request, ben), c = as(request, cleo), d = as(request, dana)
    const tag = `Tag${Date.now().toString(36)}`
    await v.follow(ben.username)
    await d.setProtected()
    await v.follow(dana.username)
    await d.approve(viewer.username)

    const cleoOriginal = await c.post('cleo original to be quoted')
    const cleoOther = await c.post('cleo post that ben reposts')
    await c.post('cleo own post nobody here follows')
    await b.repost(cleoOther.id)
    await b.post('ben quotes her', { quotedPostId: cleoOriginal.id })
    await b.post(`hello @${viewer.username} #${tag} see https://example.com/page.\nsecond line`)
    await d.post('dana private thought')

    await signIn(page, viewer)

    await expect(page.getByRole('article')).toHaveCount(4)
    const texts = await page.getByRole('article').allTextContents()
    // Newest first: dana, ben's text, ben's quote, ben's repost.
    expect(texts[0]).toContain('dana private thought')
    expect(texts[1]).toContain('see example.com/page.')
    expect(texts[2]).toContain('ben quotes her')
    expect(texts[3]).toContain('cleo post that ben reposts')
    await expect(page.getByText('cleo own post nobody here follows')).toHaveCount(0)

    const danaCard = page.getByRole('article', { name: 'Post by Dana Private' })
    await expect(danaCard.getByLabel('Protected account')).toBeVisible()
    await expect(page.getByRole('article', { name: 'Post by Ben Builder' }).getByLabel('Protected account')).toHaveCount(0)

    const linked = page.getByRole('article').filter({ hasText: `#${tag}` })
    await expect(linked.getByRole('link', { name: `#${tag}` })).toHaveAttribute('href', `/hashtag/${tag.toLowerCase()}`)
    await expect(linked.getByRole('link', { name: `@${viewer.username}` })).toHaveAttribute('href', `/u/${viewer.username}`)
    const external = linked.getByRole('link', { name: 'example.com/page' })
    await expect(external).toHaveAttribute('href', 'https://example.com/page')
    await expect(external).toHaveAttribute('target', '_blank')
    await expect(external).toHaveAttribute('rel', /noopener/)

    const quoteCard = page.getByRole('article').filter({ hasText: 'ben quotes her' })
    await expect(quoteCard.getByRole('group', { name: 'Quoted post by Cleo Stranger' })).toContainText('cleo original to be quoted')

    const repostCard = page.getByRole('article').filter({ hasText: 'cleo post that ben reposts' })
    await expect(repostCard).toContainText('Ben Builder reposted')
    await expect(repostCard.getByRole('link', { name: 'Cleo Stranger' })).toBeVisible()

    await page.screenshot(shot('timeline-desktop'))
  })

  test('loads older posts as you scroll, without repeats', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request)
    await as(request, viewer).follow(ben.username)
    const b = as(request, ben)
    for (let i = 1; i <= 25; i++) await b.post(`bulk post ${String(i).padStart(2, '0')}`)

    await signIn(page, viewer)
    await expect(page.getByRole('article')).toHaveCount(20) // the first page

    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        return page.getByRole('article').count()
      }, { timeout: 15_000 })
      .toBe(25)
    const texts = await page.getByRole('article').allTextContents()
    expect(new Set(texts).size).toBe(25)
    expect(texts[0]).toContain('bulk post 25')
    expect(texts[24]).toContain('bulk post 01')
  })

  test('the refresh button brings in new posts', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request)
    await as(request, viewer).follow(ben.username)
    const b = as(request, ben)
    await b.post('already there')
    await signIn(page, viewer)
    await expect(page.getByRole('article')).toHaveCount(1)

    await b.post('arrived later')
    await page.getByRole('button', { name: 'Refresh timeline' }).click()

    await expect(page.getByRole('article')).toHaveCount(2)
    await expect(page.getByRole('article').first()).toContainText('arrived later')
  })

  test('a new account sees a welcome message', async ({ page, request }) => {
    const viewer = await createUser(request)
    await signIn(page, viewer)
    await expect(page.getByText('Welcome to XClone')).toBeVisible()
    await page.screenshot(shot('timeline-empty'))
  })

  test('markup typed into a post is shown as text and never runs', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request)
    await as(request, viewer).follow(ben.username)
    await as(request, ben).post('<b>bold</b> <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script>')

    await signIn(page, viewer)

    await expect(page.getByRole('article')).toContainText('<b>bold</b>')
    await expect(page.getByRole('article').locator('b, script')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  })

  test('a failed load offers "Try again" and recovers', async ({ page, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request)
    await as(request, viewer).follow(ben.username)
    await as(request, ben).post('worth waiting for')
    let broken = true
    await page.route('**/api/timeline*', (route) =>
      broken ? route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ status: 500, detail: 'Something went wrong' }) }) : route.continue(),
    )

    await signIn(page, viewer)
    await expect(page.getByRole('alert')).toContainText('Something went wrong')
    await page.screenshot(shot('timeline-error'))

    broken = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('article')).toContainText('worth waiting for')
  })

  test('images are laid out for one, two, three and four attachments; long words do not overflow', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = { id: 9, username: 'pixel', displayName: 'Pixel Poster', avatarUrl: 'https://media.test/avatar.png', protectedAccount: false }
    const post = (n: number, content: string) => ({
      id: 5000 + n, author, content, mediaUrls: Array.from({ length: n }, (_, i) => `https://media.test/p${n}-${i}.png`),
      replyToId: null, likeCount: n, replyCount: 0, likedByMe: false, createdAt: new Date().toISOString(), repostCount: 0, repostedByMe: false,
      repostedBy: null, quotedPost: null, mentions: [], conversationId: 5000 + n, replyPolicy: 'EVERYONE', canReply: true,
    })
    await page.route('https://media.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await page.route('**/api/timeline*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ items: [post(4, 'four ' + 'x'.repeat(120)), post(3, 'three'), post(2, 'two'), post(1, 'one')], nextCursor: null }),
      }),
    )

    await signIn(page, viewer)

    for (const [n, label] of [[4, 'four'], [3, 'three'], [2, 'two'], [1, 'one']] as const) {
      const card = page.getByRole('article').filter({ hasText: new RegExp(`^.*${label}`) }).first()
      await expect(card.locator('img[alt*="attached to the post"]')).toHaveCount(n)
    }
    await expect.poll(() => page.evaluate(() => [...document.images].filter((i) => i.alt.includes('attached') && i.naturalWidth > 0).length)).toBe(10)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('timeline-media'))
  })

  test('the timeline fits a phone', async ({ browser, request }) => {
    const viewer = await createUser(request)
    const ben = await createUser(request, { displayName: 'Ben Builder' })
    await as(request, viewer).follow(ben.username)
    await as(request, ben).post(`a post on a small screen #${uniqueName('mob')} ${'wordwordword '.repeat(15)}`)
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true })
    const page = await context.newPage()

    await signIn(page, viewer)

    await expect(page.getByRole('article')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('timeline-mobile'))
    await context.close()
  })
})
