import { expect, test, type Page } from '@playwright/test'
import { as, createUser, shot, signIn } from './support'

const card = (page: Page, text: string) => page.getByRole('article').filter({ hasText: text })

test.describe('the post page', () => {
  test('shows the post large, with its date, counts, replies oldest first, and a reply box', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request, { displayName: 'Ben Builder' })
    const fan1 = await createUser(request)
    const fan2 = await createUser(request)
    const post = await as(request, author).post('the post everyone is talking about #chat')
    await as(request, fan1).reply(post.id, 'first reply here')
    await as(request, fan2).reply(post.id, 'second reply here')
    await as(request, fan1).like(post.id)
    await signIn(page, viewer, `/post/${post.id}`)

    const focused = page.getByRole('article', { name: 'Post by Ben Builder' }).first()
    await expect(focused).toContainText('the post everyone is talking about')
    await expect(focused.getByRole('group', { name: 'Post statistics' })).toContainText('1 Like')
    await expect(focused.getByRole('group', { name: 'Post statistics' })).toContainText('2 Replies')
    await expect(focused.locator('time')).toContainText(/\d{4}/) // the full date, not "2m"
    await expect(page.getByRole('textbox', { name: 'Post text' })).toBeVisible()
    await expect(card(page, 'second reply here')).toBeVisible()
    const order = await page.getByRole('article').allTextContents()
    expect(order.findIndex((t) => t.includes('first reply here'))).toBeLessThan(order.findIndex((t) => t.includes('second reply here')))
    await page.screenshot(shot('detail-desktop'))
  })

  test('replying from the page adds the reply and the count', async ({ page, request }) => {
    const viewer = await createUser(request, { displayName: 'Vera Viewer' })
    const author = await createUser(request)
    const post = await as(request, author).post('please reply to this')
    await signIn(page, viewer, `/post/${post.id}`)

    await page.getByRole('textbox', { name: 'Post text' }).fill('here is my reply')
    await page.getByRole('button', { name: 'Post reply' }).click()

    await expect(page.getByText('Your reply was sent.')).toBeVisible()
    await expect(card(page, 'here is my reply')).toBeVisible()
    await expect(page.getByRole('group', { name: 'Post statistics' }).first()).toContainText('1 Reply')
    await expect(page.getByRole('textbox', { name: 'Post text' })).toHaveValue('')
  })

  test('a reply shows the post it answers above it, and the author’s thread follows the first post', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request, { displayName: 'Thea Thread' })
    const other = await createUser(request, { displayName: 'Olly Other' })
    const [first] = await as(request, author).thread(['part one of the story', 'part two of the story', 'part three of the story'])
    await as(request, other).reply(first.id, 'my own comment on part one')

    await signIn(page, viewer, `/post/${first.id}`)
    const more = page.getByRole('region', { name: 'More from the author' })
    await expect(more).toContainText('part two of the story')
    await expect(more).toContainText('part three of the story')
    await expect(card(page, 'my own comment on part one')).toBeVisible()
    await expect(page.getByText('part two of the story')).toHaveCount(1) // not repeated in the replies list
    await page.screenshot(shot('detail-thread'))

    const replies = await as(request, other).get(`/api/users/${other.username}/replies`)
    await page.goto(`/post/${replies.items[0].id}`)
    await expect(page.getByRole('article').first()).toContainText('part one of the story') // the post it answers, above
  })

  test('the quoted post inside a post opens its own page', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request)
    const original = await as(request, author).post('the original thought')
    const quote = await as(request, author).post('adding my voice', { quotedPostId: original.id })
    await signIn(page, viewer, `/post/${quote.id}`)

    await page.getByRole('group', { name: /Quoted post by/ }).click()

    await expect(page).toHaveURL(new RegExp(`/post/${original.id}$`))
    await expect(page.getByRole('article', { name: /Post by/ }).first()).toContainText('the original thought')
  })

  test('who liked it: a list of people', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request)
    const fan1 = await createUser(request, { displayName: 'Fanny One' })
    const fan2 = await createUser(request, { displayName: 'Fred Two' })
    const post = await as(request, author).post('liked by two people')
    await as(request, fan1).like(post.id)
    await as(request, fan2).like(post.id)
    await signIn(page, viewer, `/post/${post.id}`)

    await page.getByRole('button', { name: '2 Likes' }).click()

    const dialog = page.getByRole('dialog', { name: 'Liked by' })
    await expect(dialog.getByRole('link', { name: /Fred Two/ })).toBeVisible()
    await expect(dialog.getByRole('link', { name: /Fanny One/ })).toBeVisible()
    await page.screenshot(shot('detail-likers'))
  })

  test('when the author limits replies you see why instead of a reply box', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request)
    const post = await as(request, author).post('replies are limited here')
    await as(request, author).setPolicy(post.id, 'FOLLOWING')
    await signIn(page, viewer, `/post/${post.id}`)

    await expect(page.getByText('The author limits who can reply to this conversation.')).toBeVisible()
    await expect(page.getByText('Only accounts the author follows can reply.')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Post text' })).toHaveCount(0)
  })
})

test.describe('posts that cannot be shown', () => {
  test('a deleted post', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request)
    const post = await as(request, author).post('here today')
    await request.delete(`/api/posts/${post.id}`, { headers: { Authorization: `Bearer ${author.accessToken}` } })
    await signIn(page, viewer, `/post/${post.id}`)
    await expect(page.getByText("This post doesn't exist")).toBeVisible()
    await page.screenshot(shot('detail-deleted'))
  })

  test('a protected account’s post you are not allowed to see', async ({ page, request }) => {
    const viewer = await createUser(request)
    const priv = await createUser(request)
    await as(request, priv).setProtected()
    const post = await as(request, priv).post('private words')
    await signIn(page, viewer, `/post/${post.id}`)
    await expect(page.getByText('These posts are protected')).toBeVisible()
    await expect(page.getByText('private words')).toHaveCount(0)
    await page.screenshot(shot('detail-protected'))
  })

  test('a post from someone who blocked you', async ({ page, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request)
    const post = await as(request, author).post('you cannot see this')
    await as(request, author).block(viewer.username)
    await signIn(page, viewer, `/post/${post.id}`)
    await expect(page.getByText("You can't view this post")).toBeVisible()
    await expect(page.getByText('because of a block')).toBeVisible()
  })

  test('an address that is not a post', async ({ page, request }) => {
    await signIn(page, await createUser(request), '/post/abc')
    await expect(page.getByText("This post doesn't exist")).toBeVisible()
  })
})

test.describe('on a phone', () => {
  test('the post page and its dialogs fit the screen', async ({ browser, request }) => {
    const viewer = await createUser(request)
    const author = await createUser(request)
    const post = await as(request, author).post(`a post on a small screen ${'word '.repeat(30)}`)
    const context = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true })
    const page = await context.newPage()
    await signIn(page, viewer, `/post/${post.id}`)

    await expect(page.getByRole('article', { name: /Post by/ }).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('detail-mobile'))

    // Nothing may sit on top of the reply button: what is at its centre must be the button itself.
    await page.getByRole('textbox', { name: 'Post text' }).fill('x')
    const reply = page.getByRole('button', { name: 'Post reply' })
    const box = (await reply.boundingBox())!
    const coveredBy = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    expect(coveredBy).toBe('Post reply')

    // The Reply button opens the composer in a dialog; it must fit a phone too.
    await page.getByRole('button', { name: 'Reply', exact: true }).first().click()
    await expect(page.getByRole('dialog', { name: 'Reply' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('detail-mobile-dialog'))
    await context.close()
  })
})
