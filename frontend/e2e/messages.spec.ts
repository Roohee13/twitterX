import { expect, test, type Page } from '@playwright/test'
import { as, createUser, shot, signIn } from './support'

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const messagesLink = (page: Page, name: string | RegExp = /^Messages/) => mainNav(page).getByRole('link', { name })
const box = (page: Page) => page.getByRole('textbox', { name: 'Message' })

test.describe('messages', () => {
  test('start a chat from a profile, send, and the other person sees it live; they answer and it comes back live', async ({ browser, page, request }) => {
    const ann = await createUser(request, { displayName: 'Ann Sender' })
    const ben = await createUser(request, { displayName: 'Ben Receiver' })
    const benPage = await (await browser.newContext()).newPage()
    await signIn(benPage, ben)
    await expect(messagesLink(benPage, 'Messages')).toBeVisible() // loaded, nothing unread

    await signIn(page, ann, `/u/${ben.username}`)
    await page.getByRole('button', { name: 'Message Ben Receiver' }).click()
    await expect(page).toHaveURL(/\/messages\/\d+$/)
    await expect(page.getByRole('heading', { name: 'Ben Receiver', level: 1 })).toBeVisible()
    await expect(page.getByText('No messages yet. Say hello to Ben Receiver.')).toBeVisible()
    await box(page).fill('hello Ben')
    await box(page).press('Shift+Enter')
    await box(page).pressSequentially('second line')
    await box(page).press('Enter')
    await expect(page.getByText('second line')).toBeVisible()
    await expect(page.getByText('Sending…')).toHaveCount(0)
    await page.screenshot(shot('messages-sent'))

    // Ben's badge went up without a reload; the inbox shows the preview and the unread count.
    await expect(messagesLink(benPage, 'Messages (1 unread)')).toBeVisible()
    await messagesLink(benPage).click()
    const row = benPage.getByRole('link', { name: 'Conversation with Ann Sender, 1 unread' })
    await expect(row).toContainText('hello Ben')
    await benPage.screenshot(shot('messages-inbox-unread'))
    await row.click()
    await expect(benPage.getByText('second line')).toBeVisible()
    await expect(messagesLink(benPage, 'Messages')).toBeVisible() // read: the badge is gone

    // Ben answers; Ann, sitting in the open chat, gets it live.
    await box(benPage).fill('hi Ann, got it')
    await box(benPage).press('Enter')
    await expect(page.getByText('hi Ann, got it')).toBeVisible()
    await expect(messagesLink(page, 'Messages')).toBeVisible() // she is looking at it, so it is not "unread"
    await page.screenshot(shot('messages-reply-live'))
  })

  test('unread counts survive a reload, and the inbox puts the most recently active conversation first', async ({ page, request }) => {
    const me = await createUser(request)
    const a = await createUser(request, { displayName: 'Ava Old' })
    const b = await createUser(request, { displayName: 'Bo Newer' })
    const c = await createUser(request, { displayName: 'Cy Newest' })
    const conv = async (from: typeof a, text: string) => {
      const res = await as(request, from).startConversation(me.username)
      await as(request, from).sendMessage(res.id, text)
      return res.id as number
    }
    const first = await conv(a, 'from ava')
    await conv(b, 'from bo')
    await conv(c, 'from cy')
    await as(request, a).sendMessage(first, 'ava again') // the oldest conversation is now the most recently active

    await signIn(page, me, '/messages')
    await expect(messagesLink(page, 'Messages (4 unread)')).toBeVisible()
    const rows = page.getByRole('link', { name: /^Conversation with/ })
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toHaveAccessibleName(/Ava Old/)
    await expect(rows.nth(1)).toHaveAccessibleName(/Cy Newest/)
    await expect(rows.nth(2)).toHaveAccessibleName(/Bo Newer/)
    await expect(rows.first()).toContainText('ava again')
    await expect(rows.first()).toHaveAccessibleName('Conversation with Ava Old, 2 unread')

    await page.reload()
    await expect(messagesLink(page, 'Messages (4 unread)')).toBeVisible()
    await rows.first().click()
    await expect(page.getByText('ava again')).toBeVisible()
    await expect(messagesLink(page, 'Messages (2 unread)')).toBeVisible()
  })

  test('messages read oldest to newest, a message you send or receive lands at the bottom, right above the writing box, and a reload keeps the order', async ({ browser, page, request }) => {
    const me = await createUser(request)
    const friend = await createUser(request, { displayName: 'Order Friend' })
    const { id } = await as(request, me).startConversation(friend.username)
    for (let i = 1; i <= 5; i++) await as(request, i % 2 ? friend : me).sendMessage(id, `seed ${i}`)
    const texts = async (p: Page) => (await p.locator('main p').allTextContents()).filter((t) => /^(seed|sent|received)/.test(t))
    const gapAboveBox = async (p: Page, text: string) => {
      const bubble = await p.getByText(text, { exact: true }).boundingBox()
      const field = await box(p).boundingBox()
      return { gap: field!.y - (bubble!.y + bubble!.height), onScreen: bubble!.y >= 0 }
    }
    await signIn(page, me, `/messages/${id}`)
    await expect(page.getByText('seed 5')).toBeVisible()
    expect(await texts(page)).toEqual(['seed 1', 'seed 2', 'seed 3', 'seed 4', 'seed 5'])

    await box(page).fill('sent by me')
    await box(page).press('Enter')
    await expect(page.getByText('Sending…')).toHaveCount(0)
    await expect.poll(() => texts(page)).toEqual(['seed 1', 'seed 2', 'seed 3', 'seed 4', 'seed 5', 'sent by me'])
    const sent = await gapAboveBox(page, 'sent by me')
    expect(sent.onScreen).toBe(true)
    expect(sent.gap).toBeGreaterThanOrEqual(0)
    expect(sent.gap).toBeLessThan(100) // directly above the box, not somewhere up the page

    // The friend writes back from another browser: it arrives live at the bottom, in the open chat.
    const friendPage = await (await browser.newContext()).newPage()
    await as(request, friend).sendMessage(id, 'received from friend')
    await expect.poll(() => texts(page)).toEqual(['seed 1', 'seed 2', 'seed 3', 'seed 4', 'seed 5', 'sent by me', 'received from friend'])
    expect((await gapAboveBox(page, 'received from friend')).gap).toBeLessThan(100)
    await friendPage.close()

    await page.reload()
    await expect(page.getByText('received from friend')).toBeVisible()
    expect(await texts(page)).toEqual(['seed 1', 'seed 2', 'seed 3', 'seed 4', 'seed 5', 'sent by me', 'received from friend'])
    expect((await gapAboveBox(page, 'received from friend')).gap).toBeLessThan(100)
  })

  test('in a long conversation the newest message is on screen right above the box, after loading and after sending', async ({ page, request }) => {
    const me = await createUser(request)
    const friend = await createUser(request, { displayName: 'Long Talker' })
    const { id } = await as(request, me).startConversation(friend.username)
    for (let i = 1; i <= 40; i++) await as(request, i % 2 ? friend : me).sendMessage(id, `long ${i}`)
    await signIn(page, me, `/messages/${id}`)
    await expect(page.getByText('long 40', { exact: true })).toBeVisible()
    const near = async (text: string) => {
      await expect.poll(async () => {
        const bubble = await page.getByText(text, { exact: true }).boundingBox()
        const field = await box(page).boundingBox()
        return bubble && field ? { onScreen: bubble.y >= 0 && bubble.y + bubble.height <= field.y, gap: Math.round(field.y - (bubble.y + bubble.height)) } : null
      }).toMatchObject({ onScreen: true })
      const bubble = (await page.getByText(text, { exact: true }).boundingBox())!
      const field = (await box(page).boundingBox())!
      expect(field.y - (bubble.y + bubble.height)).toBeLessThan(100)
    }
    await near('long 40')

    await box(page).fill('long sent')
    await box(page).press('Enter')
    await near('long sent')
  })

  test('a long conversation loads older messages on request', async ({ page, request }) => {
    const me = await createUser(request)
    const friend = await createUser(request, { displayName: 'Chatty Friend' })
    const { id } = await as(request, me).startConversation(friend.username)
    for (let i = 1; i <= 35; i++) await as(request, me).sendMessage(id, `message number ${i}`)

    await signIn(page, me, `/messages/${id}`)
    await expect(page.getByText('message number 35')).toBeVisible()
    await expect(page.getByText('message number 3', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Load older messages' }).click()
    await expect(page.getByText('message number 1', { exact: true })).toBeVisible()
    const shown = (await page.locator('main p').allTextContents()).filter((t) => t.startsWith('message number'))
    expect(shown).toEqual(Array.from({ length: 35 }, (_, i) => `message number ${i + 1}`)) // oldest first, no gaps, no repeats
    await expect(page.getByRole('button', { name: 'Load older messages' })).toHaveCount(0)
  })

  test('when the other person blocks you, sending fails with the reason and the chat leaves their inbox', async ({ page, request }) => {
    const ann = await createUser(request, { displayName: 'Ann Blocked' })
    const ben = await createUser(request, { displayName: 'Ben Blocker' })
    const { id } = await as(request, ann).startConversation(ben.username)
    await as(request, ann).sendMessage(id, 'before the block')
    await signIn(page, ann, `/messages/${id}`)
    await expect(page.getByText('before the block')).toBeVisible()

    await as(request, ben).block(ann.username)
    await box(page).fill('are you there?')
    await box(page).press('Enter')

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await page.screenshot(shot('messages-send-failed'))
    await alert.getByRole('button', { name: 'Discard' }).click()
    await expect(page.getByText('are you there?')).toHaveCount(0)
    await page.goto('/messages')
    await expect(page.getByText('No messages yet')).toBeVisible()
  })

  test('you cannot open someone else\'s conversation', async ({ page, request }) => {
    const ann = await createUser(request)
    const ben = await createUser(request)
    const stranger = await createUser(request)
    const { id } = await as(request, ann).startConversation(ben.username)
    await signIn(page, stranger, `/messages/${id}`)
    await expect(page.getByRole('alert')).toContainText('Conversation not found')
  })

  test('New message finds a person and opens the chat', async ({ page, request }) => {
    const me = await createUser(request)
    const friend = await createUser(request, { displayName: 'Findable Friend' })
    await signIn(page, me, '/messages')
    await page.getByRole('button', { name: /New message/ }).click()
    await page.getByRole('dialog', { name: 'New message' }).getByLabel('Search people').fill(friend.username)
    await page.getByRole('dialog', { name: 'New message' }).getByRole('button', { name: new RegExp(friend.username) }).click()
    await expect(page).toHaveURL(/\/messages\/\d+$/)
    await expect(page.getByRole('heading', { name: 'Findable Friend', level: 1 })).toBeVisible()
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } })

  test('the inbox and the chat fit the screen, with the writing box above the bottom bar', async ({ page, request }) => {
    const me = await createUser(request)
    const friend = await createUser(request, { displayName: 'Phone Friend' })
    const { id } = await as(request, friend).startConversation(me.username)
    await as(request, friend).sendMessage(id, 'a fairly long message that has to wrap onto several lines on a narrow phone screen without overflowing')
    await signIn(page, me, '/messages')
    await expect(page.getByRole('link', { name: /Conversation with Phone Friend/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('messages-phone-inbox'))

    await page.getByRole('link', { name: /Conversation with Phone Friend/ }).click()
    await expect(page.getByText(/a fairly long message/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const lastBubble = await page.getByText(/a fairly long message/).boundingBox()
    const composer = await box(page).boundingBox()
    expect(composer!.y - (lastBubble!.y + lastBubble!.height)).toBeLessThan(100) // the message sits right above the writing box
    const bar = await page.getByRole('navigation', { name: 'Main (mobile)' }).boundingBox()
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(bar!.y + 1)
    await page.waitForTimeout(300) // let any scrolling settle
    await page.screenshot(shot('messages-phone-chat'))
  })
})
