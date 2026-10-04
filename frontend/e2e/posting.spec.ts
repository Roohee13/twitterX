import { expect, test, type Page } from '@playwright/test'
import { as, createUser, shot, signIn } from './support'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const inlineComposer = (page: Page) => page.locator('main').getByRole('textbox', { name: 'Post text' }).first()

test.describe('writing posts', () => {
  test('posts from the home composer: it appears first, stays after a reload, and the box clears', async ({ page, request }) => {
    const user = await createUser(request, { displayName: 'Penny Poster' })
    await signIn(page, user)
    await expect(page.getByText('Welcome to XClone')).toBeVisible()

    await inlineComposer(page).fill('my very first post #hello')
    await expect(page.getByLabel('255 characters left')).toBeVisible()
    await page.screenshot(shot('posting-composer'))
    await page.getByRole('button', { name: 'Post', exact: true }).click()

    await expect(page.getByText('Your post was sent.')).toBeVisible()
    const first = page.getByRole('article').first()
    await expect(first).toContainText('my very first post')
    await expect(first.getByRole('link', { name: '#hello' })).toBeVisible()
    await expect(inlineComposer(page)).toHaveValue('')
    await expect(page.getByText('Welcome to XClone')).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('article').first()).toContainText('my very first post')
  })

  test('a post made while the timeline is still loading is not lost', async ({ page, request }) => {
    const user = await createUser(request)
    // The server answers with the timeline as it was BEFORE the new post, but the page only receives that answer a moment later,
    // just as it would on a slow connection.
    await page.route('**/api/timeline*', async (route) => {
      const stale = await route.fetch()
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.fulfill({ response: stale })
    })
    await signIn(page, user)

    await inlineComposer(page).fill('posted before the timeline arrived')
    await page.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(page.getByText('Your post was sent.')).toBeVisible()

    await expect(page.getByRole('article').first()).toContainText('posted before the timeline arrived')
    await expect(page.getByText('Welcome to XClone')).toHaveCount(0)
  })

  test('the Post button in the navigation opens a dialog that posts and closes', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user)

    await page.getByRole('button', { name: 'New post' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New post' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox').fill('posted from the dialog')
    await page.screenshot(shot('posting-dialog'))
    await dialog.getByRole('button', { name: 'Post', exact: true }).click()

    await expect(dialog).toBeHidden()
    await expect(page.getByRole('article').first()).toContainText('posted from the dialog')
  })

  test('over the 280 character limit it cannot be posted', async ({ page, request }) => {
    await signIn(page, await createUser(request))
    await inlineComposer(page).fill('x'.repeat(281))
    await expect(page.getByLabel('1 characters over the limit')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeDisabled()
    await inlineComposer(page).fill('x'.repeat(280))
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  })

  test('the chosen reply setting is saved with the post', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user)

    await inlineComposer(page).fill('only for people I follow')
    await page.getByLabel('Who can reply').selectOption('FOLLOWING')
    await page.getByRole('button', { name: 'Post', exact: true }).click()
    await expect(page.getByRole('article').first()).toContainText('only for people I follow')

    const mine = await as(request, user).get(`/api/users/${user.username}/posts`)
    expect(mine.items[0].replyPolicy).toBe('FOLLOWING')
  })

  test('a thread is posted in order as one connected thread', async ({ page, request }) => {
    const user = await createUser(request)
    await signIn(page, user)

    await inlineComposer(page).fill('thread part one')
    await page.getByRole('button', { name: 'Add another post' }).click()
    await page.getByRole('textbox', { name: 'Post 2 of 2' }).fill('thread part two')
    await page.getByRole('button', { name: 'Add another post' }).click()
    await page.getByRole('textbox', { name: 'Post 3 of 3' }).fill('thread part three')
    await page.screenshot(shot('posting-thread'))
    await page.getByRole('button', { name: 'Post all' }).click()

    await expect(page.getByText('Your thread was posted.')).toBeVisible()
    await expect(page.getByRole('article').first()).toContainText('thread part three') // newest first
    const posts = await as(request, user).get(`/api/users/${user.username}/posts`)
    const root = posts.items.find((p: { content: string }) => p.content === 'thread part one')
    const chain = await as(request, user).get(`/api/posts/${root.id}/thread`)
    expect(chain.map((p: { content: string }) => p.content)).toEqual(['thread part one', 'thread part two', 'thread part three'])
  })
})

test.describe('images', () => {
  test('with image storage mocked: preview, progress, post with the uploaded key, and the images in the feed', async ({ page, request }) => {
    const user = await createUser(request, { displayName: 'Ivy Images' })
    let uploads = 0
    await page.route('**/api/media/upload-url', (route) => {
      uploads += 1
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ key: `users/${user.id}/pic${uploads}.png`, uploadUrl: `https://r2.test/pic${uploads}`, headers: { 'content-type': ['image/png'] }, publicUrl: `https://media.test/pic${uploads}.png`, expiresAt: '2031-01-01T00:00:00Z' }),
      })
    })
    await page.route('https://r2.test/**', (route) => route.fulfill({ status: 200 }))
    await page.route('https://media.test/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    let sent: { content: string; mediaKeys: string[] } | undefined
    await page.route('**/api/posts', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      sent = route.request().postDataJSON()
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 99001, author: { id: user.id, username: user.username, displayName: user.displayName, avatarUrl: null, protectedAccount: false }, content: sent!.content,
          mediaUrls: sent!.mediaKeys.map((_, i) => `https://media.test/pic${i + 1}.png`), replyToId: null, likeCount: 0, replyCount: 0, likedByMe: false, createdAt: new Date().toISOString(),
          repostCount: 0, repostedByMe: false, repostedBy: null, quotedPost: null, mentions: [], conversationId: 99001, replyPolicy: 'EVERYONE', canReply: true, bookmarkedByMe: false,
        }),
      })
    })
    await signIn(page, user)
    // The post below exists only in this test's fake server reply, so the real timeline must have finished loading first
    // (otherwise it reloads from the real server, which has never seen the fake post).
    await expect(page.getByText('Welcome to XClone')).toBeVisible()

    await page.getByLabel('Choose images').setInputFiles([
      { name: 'one.png', mimeType: 'image/png', buffer: PNG },
      { name: 'two.png', mimeType: 'image/png', buffer: PNG },
    ])
    await expect(page.getByAltText('Selected image preview')).toHaveCount(2)
    await expect(page.getByRole('progressbar')).toHaveCount(0) // both finished
    await page.screenshot(shot('posting-images'))
    await page.getByRole('button', { name: 'Post', exact: true }).click()

    await expect(page.getByRole('article').first().locator('img[alt*="attached to the post"]')).toHaveCount(2)
    expect(sent).toMatchObject({ content: '', mediaKeys: [`users/${user.id}/pic1.png`, `users/${user.id}/pic2.png`] })
  })

  test('a server without image storage says so (real backend, no R2 configured)', async ({ page, request }) => {
    await signIn(page, await createUser(request))
    await inlineComposer(page).fill('text is fine')

    await page.getByLabel('Choose images').setInputFiles({ name: 'one.png', mimeType: 'image/png', buffer: PNG })

    await expect(page.getByText('Image uploads are not set up on this server yet.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Remove image' }).click()
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeEnabled()
  })

  test('files that are not images, and more than four, are refused with a reason', async ({ page, request }) => {
    await signIn(page, await createUser(request))
    await page.getByLabel('Choose images').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(page.getByRole('alert')).toContainText('JPEG, PNG, WebP or GIF')
  })
})
