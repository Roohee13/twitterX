import { expect, test, type Page } from '@playwright/test'
import { as, createUser, shot, signIn } from './support'

const card = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text })

/** A viewer who follows an author with one post, ready on the home timeline. */
async function setup(page: Page, request: Parameters<typeof createUser>[0], text: string, authorOverrides: { displayName?: string } = {}) {
  const viewer = await createUser(request, { displayName: 'Vera Viewer' })
  const author = await createUser(request, { displayName: authorOverrides.displayName ?? 'Ben Builder' })
  await as(request, viewer).follow(author.username)
  const post = await as(request, author).post(text)
  await signIn(page, viewer)
  await expect(card(page, text)).toBeVisible()
  return { viewer, author, post }
}

test.describe('like, bookmark, repost', () => {
  test('a like is remembered by the server: still there after a reload, and can be undone', async ({ page, request }) => {
    await setup(page, request, 'like this one')
    const post = card(page, 'like this one')

    await post.getByRole('button', { name: 'Like', exact: true }).click()
    await expect(post.getByRole('button', { name: 'Unlike' })).toContainText('1')

    await page.reload()
    await expect(card(page, 'like this one').getByRole('button', { name: 'Unlike' })).toContainText('1')

    await card(page, 'like this one').getByRole('button', { name: 'Unlike' }).click()
    await page.reload()
    await expect(card(page, 'like this one').getByRole('button', { name: 'Like', exact: true })).not.toContainText('1')
  })

  test('a bookmark is remembered by the server (the bookmarkedByMe flag)', async ({ page, request }) => {
    await setup(page, request, 'save for later')

    await card(page, 'save for later').getByRole('button', { name: 'Bookmark' }).click()
    await expect(card(page, 'save for later').getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await expect(card(page, 'save for later').getByRole('button', { name: 'Remove bookmark' })).toBeVisible()
    await card(page, 'save for later').getByRole('button', { name: 'Remove bookmark' }).click()
    await page.reload()
    await expect(card(page, 'save for later').getByRole('button', { name: 'Bookmark' })).toBeVisible()
  })

  test('reposting shows a repost in your own timeline, survives a reload, and can be undone', async ({ page, request }) => {
    await setup(page, request, 'worth sharing')

    await card(page, 'worth sharing').getByRole('button', { name: 'Repost', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Repost', exact: true }).click()
    await expect(card(page, 'worth sharing').first().getByRole('button', { name: 'Repost (you reposted this)' })).toContainText('1')

    await page.reload()
    await expect(page.getByRole('article').filter({ hasText: 'Vera Viewer reposted' })).toBeVisible() // the repost row
    await card(page, 'worth sharing').first().getByRole('button', { name: 'Repost (you reposted this)' }).click()
    await page.getByRole('menuitem', { name: 'Undo repost' }).click()

    await page.reload()
    await expect(page.getByRole('article').filter({ hasText: 'Vera Viewer reposted' })).toHaveCount(0)
  })

  test('the like count on the timeline and on the post page stay in step without a reload', async ({ page, request }) => {
    const { post } = await setup(page, request, 'seen in two places')

    await card(page, 'seen in two places').getByRole('button', { name: 'Like', exact: true }).click()
    await card(page, 'seen in two places').getByRole('link', { name: /^\d+[smhd]$|^now$/ }).click() // open the post
    await expect(page).toHaveURL(new RegExp(`/post/${post.id}$`))
    await expect(page.getByRole('group', { name: 'Post statistics' })).toContainText('1 Like')

    await page.getByRole('button', { name: 'Unlike' }).first().click()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(card(page, 'seen in two places').getByRole('button', { name: 'Like', exact: true })).not.toContainText('1')
  })

  test('copying the link puts the post address on the clipboard', async ({ browser, request }) => {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    const { post } = await setup(page, request, 'link me')

    await card(page, 'link me').getByRole('button', { name: 'Copy link to post' }).click()

    await expect(page.getByText('Link copied to clipboard.')).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://127.0.0.1:5174/post/${post.id}`)
    await context.close()
  })
})

test.describe('quote and reply', () => {
  test('quoting opens a dialog showing the post; the quote post appears with the original embedded', async ({ page, request }) => {
    await setup(page, request, 'quote worthy')

    await card(page, 'quote worthy').getByRole('button', { name: 'Repost', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Quote' }).click()
    const dialog = page.getByRole('dialog', { name: 'Quote' })
    await expect(dialog.getByRole('group', { name: 'Quoting Ben Builder' })).toContainText('quote worthy')
    await dialog.getByRole('textbox').fill('so true')
    await page.screenshot(shot('actions-quote-dialog'))
    await dialog.getByRole('button', { name: 'Post', exact: true }).click()

    const quote = page.getByRole('article').first()
    await expect(quote).toContainText('so true')
    await expect(quote.getByRole('group', { name: 'Quoted post by Ben Builder' })).toContainText('quote worthy')
  })

  test('replying through the dialog raises the count, and the reply shows on the post page', async ({ page, request }) => {
    const { post } = await setup(page, request, 'ask me anything')

    await card(page, 'ask me anything').getByRole('button', { name: 'Reply', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Reply' })
    await expect(dialog.getByRole('group', { name: 'Replying to Ben Builder' })).toContainText('ask me anything')
    await dialog.getByRole('textbox').fill('a fine question')
    await dialog.getByRole('button', { name: 'Reply', exact: true }).click()

    await expect(page.getByText('Your reply was sent.')).toBeVisible()
    await expect(card(page, 'ask me anything').getByRole('button', { name: 'Reply', exact: true })).toContainText('1')
    await page.goto(`/post/${post.id}`)
    await expect(page.getByRole('article').filter({ hasText: 'a fine question' })).toBeVisible()
  })

  test('replies can be limited by the author: the button is disabled and says why', async ({ page, request }) => {
    const { post, author } = await setup(page, request, 'closed conversation')
    await as(request, author).setPolicy(post.id, 'FOLLOWING')
    await page.reload()

    const reply = card(page, 'closed conversation').getByRole('button', { name: 'Replies are limited by the author' })
    await expect(reply).toBeDisabled()
    await expect(reply).toHaveAttribute('title', 'The author limits who can reply')
  })

  test("a protected account's posts cannot be reposted or quoted", async ({ page, request }) => {
    const viewer = await createUser(request)
    const priv = await createUser(request, { displayName: 'Paula Private' })
    await as(request, priv).setProtected()
    await as(request, viewer).follow(priv.username)
    await as(request, priv).approve(viewer.username)
    await as(request, priv).post('for approved followers only')
    await signIn(page, viewer)

    await card(page, 'for approved followers only').getByRole('button', { name: 'Repost', exact: true }).click()

    await expect(page.getByRole('menuitem', { name: 'Repost', exact: true })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: 'Quote' })).toBeDisabled()
    await expect(card(page, 'for approved followers only').getByLabel('Protected account')).toBeVisible()
  })
})

test.describe('your own posts and reports', () => {
  test('edit: the new text shows at once and is saved', async ({ page, request }) => {
    const user = await createUser(request)
    await as(request, user).post('typo in this post')
    await signIn(page, user)

    await card(page, 'typo in this post').getByRole('button', { name: 'More actions' }).click()
    await page.screenshot(shot('actions-menu-own'))
    await page.getByRole('menuitem', { name: 'Edit post' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit post' })
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
    await dialog.getByRole('textbox').fill('fixed this post #edited')
    await page.screenshot(shot('actions-edit-dialog'))
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect(page.getByText('Your post was updated.')).toBeVisible()
    await expect(card(page, 'fixed this post')).toBeVisible()
    await page.reload()
    await expect(card(page, 'fixed this post').getByRole('link', { name: '#edited' })).toBeVisible()
    await expect(page.getByText('typo in this post')).toHaveCount(0)
  })

  test('delete asks first, then the post is gone everywhere, including its own page', async ({ page, request }) => {
    const user = await createUser(request)
    const post = await as(request, user).post('delete me please')
    await as(request, user).post('keep me')
    await signIn(page, user)

    await card(page, 'delete me please').getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete post' }).click()
    await page.screenshot(shot('actions-delete-dialog'))
    await expect(page.getByRole('dialog', { name: 'Delete post?' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByText('Your post was deleted.')).toBeVisible()
    await expect(page.getByText('delete me please')).toHaveCount(0)
    await expect(card(page, 'keep me')).toBeVisible()
    await page.goto(`/post/${post.id}`)
    await expect(page.getByText("This post doesn't exist")).toBeVisible()
  })

  test("changing who can reply to your own post updates the server and other people's buttons", async ({ browser, page, request }) => {
    const { viewer, author, post } = await setup(page, request, 'my own conversation')
    const authorContext = await browser.newContext()
    const authorPage = await authorContext.newPage()
    await signIn(authorPage, author)

    await card(authorPage, 'my own conversation').getByRole('button', { name: 'More actions' }).click()
    await authorPage.getByRole('menuitem', { name: 'Who can reply' }).click()
    const dialog = authorPage.getByRole('dialog', { name: 'Who can reply?' })
    await expect(dialog.getByLabel(/^Everyone/)).toBeChecked()
    await dialog.getByLabel(/Only people you mention/).check()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(authorPage.getByText('Who can reply was updated.')).toBeVisible()

    const refreshed = await as(request, viewer).get(`/api/posts/${post.id}`)
    expect(refreshed).toMatchObject({ replyPolicy: 'MENTIONED', canReply: false })
    await authorContext.close()
  })

  test('reporting a post asks for a reason, thanks you, and a repeat is handled calmly', async ({ page, request }) => {
    await setup(page, request, 'questionable post')

    for (const expected of [/Thanks for letting us know/, 'You already reported this post.']) {
      await card(page, 'questionable post').getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: 'Report post' }).click()
      const dialog = page.getByRole('dialog', { name: 'Report post' })
      await expect(dialog.getByRole('button', { name: 'Report' })).toBeDisabled()
      await dialog.getByLabel("It's spam").check()
      if (expected instanceof RegExp) await page.screenshot(shot('actions-report-dialog'))
      await dialog.getByRole('button', { name: 'Report' }).click()
      await expect(page.getByText(expected)).toBeVisible()
      await expect(dialog).toBeHidden()
    }
  })
})

test.describe('opening posts', () => {
  test('clicking a card opens the post and Back returns to the timeline', async ({ page, request }) => {
    const { post } = await setup(page, request, 'open this post')

    await card(page, 'open this post').click({ position: { x: 300, y: 6 } })

    await expect(page).toHaveURL(new RegExp(`/post/${post.id}$`))
    await expect(page.getByRole('heading', { name: 'Post' })).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(card(page, 'open this post')).toBeVisible()
  })

  test('a link inside a card goes where it says, not to the post', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request)
    await as(request, viewer).follow(author.username)
    await as(request, author).post('see #linkedtag here')
    await signIn(page, viewer)

    await page.getByRole('article').getByRole('link', { name: '#linkedtag' }).click()

    await expect(page).toHaveURL(/\/hashtag\/linkedtag$/)
  })

  test('the menu works from the keyboard and Escape closes it', async ({ page, request }) => {
    await setup(page, request, 'keyboard friendly')
    const more = card(page, 'keyboard friendly').getByRole('button', { name: 'More actions' })

    await more.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Report post' })).toBeFocused()
    await page.keyboard.press('Escape')

    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(more).toBeFocused()
  })
})
