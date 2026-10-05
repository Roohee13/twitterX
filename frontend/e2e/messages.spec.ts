import { expect, test, type Browser, type Page } from '@playwright/test'
import { as, createUser, shot, signIn } from './support'

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const messagesLink = (page: Page, name: string | RegExp = /^Messages/) => mainNav(page).getByRole('link', { name })
async function signInAs(browser: Browser, user: Parameters<typeof signIn>[1], path: string) {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, user, path)
  return page
}
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

  test('editing a message: the other person sees the new text with an "edited" mark at once, in the chat and in the inbox', async ({ browser, page, request }) => {
    const ann = await createUser(request, { displayName: 'Ann Editor' })
    const ben = await createUser(request, { displayName: 'Ben Reader' })
    const { id } = await as(request, ann).startConversation(ben.username)
    await as(request, ann).sendMessage(id, 'meet at 5pm')
    await as(request, ben).sendMessage(id, 'ok, see you')
    const benPage = await (await browser.newContext()).newPage()
    await signIn(benPage, ben, `/messages/${id}`)
    await expect(benPage.getByText('meet at 5pm')).toBeVisible()
    await signIn(page, ann, `/messages/${id}`)
    await expect(page.getByText('meet at 5pm')).toBeVisible()

    // Only your own messages have the menu.
    await expect(page.getByRole('button', { name: 'Message actions' })).toHaveCount(1)
    await expect(benPage.getByRole('button', { name: 'Message actions' })).toHaveCount(1)
    await page.getByText('meet at 5pm').hover()
    await page.getByRole('button', { name: 'Message actions' }).click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    const editor = page.getByRole('textbox', { name: 'Edit message' })
    await expect(editor).toHaveValue('meet at 5pm')
    await page.screenshot(shot('messages-editing'))
    await editor.fill('meet at 6pm')
    await editor.press('Enter')

    await expect(page.getByText('meet at 6pm')).toBeVisible()
    await expect(page.getByText(/· edited/)).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Edit message' })).toHaveCount(0)
    // Ben, with the chat open, sees it change in place: no second bubble, no reload.
    await expect(benPage.getByText('meet at 6pm')).toBeVisible()
    await expect(benPage.getByText('meet at 5pm')).toHaveCount(0)
    await expect(benPage.getByText(/· edited/)).toBeVisible()
    await benPage.screenshot(shot('messages-edited-seen'))

    await page.reload()
    await expect(page.getByText('meet at 6pm')).toBeVisible()
    await expect(page.getByText(/· edited/)).toBeVisible()
    // The inbox of someone who did not have the chat open shows the new wording too.
    await as(request, ann).sendMessage(id, 'meet at 6pm, last word') // makes it the newest, so the preview is of this message
    await benPage.goto('/messages')
    await expect(benPage.getByRole('link', { name: /Conversation with Ann Editor/ })).toContainText('meet at 6pm, last word')
  })

  test('deleting a message: it becomes a note for both people at once, nothing of the text is left, and the unread count drops', async ({ browser, page, request }) => {
    const ann = await createUser(request, { displayName: 'Ann Deleter' })
    const ben = await createUser(request, { displayName: 'Ben Watcher' })
    const { id } = await as(request, ann).startConversation(ben.username)
    await as(request, ann).sendMessage(id, 'a message that should stay')
    const benMessages = await signInAs(browser, ben, '/messages')
    await expect(benMessages.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Messages (1 unread)' })).toBeVisible()

    await signIn(page, ann, `/messages/${id}`)
    await as(request, ann).sendMessage(id, 'oops, wrong chat')
    await expect(page.getByText('oops, wrong chat')).toBeVisible()
    await expect(benMessages.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Messages (2 unread)' })).toBeVisible()

    await page.getByText('oops, wrong chat').hover()
    await page.getByRole('button', { name: 'Message actions' }).last().click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.screenshot(shot('messages-delete-dialog'))
    await page.getByRole('dialog', { name: 'Delete this message?' }).getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByText('You deleted this message')).toBeVisible()
    await expect(page.getByText('oops, wrong chat')).toHaveCount(0)
    await expect(page.getByText('a message that should stay')).toBeVisible()
    // Ben's unread count went back down, and his inbox says what happened.
    await expect(benMessages.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Messages (1 unread)' })).toBeVisible()
    await expect(benMessages.getByRole('link', { name: /Conversation with Ann Deleter/ })).toContainText('This message was deleted')
    await benMessages.screenshot(shot('messages-deleted-inbox'))
    await benMessages.getByRole('link', { name: /Conversation with Ann Deleter/ }).click()
    await expect(benMessages.getByText('This message was deleted', { exact: true })).toBeVisible()
    await expect(benMessages.getByText('oops, wrong chat')).toHaveCount(0)
    // Gone from the server too, not just hidden by the screen.
    const stored = await as(request, ben).get(`/api/conversations/${id}/messages`)
    expect(JSON.stringify(stored)).not.toContain('oops, wrong chat')
  })

  test('deleting a conversation: gone for me, untouched for the other person, and back with only the new messages when they write again', async ({ browser, page, request }) => {
    test.setTimeout(120_000)
    const ann = await createUser(request, { displayName: 'Ann Keeper' })
    const ben = await createUser(request, { displayName: 'Ben Deleter' })
    const { id } = await as(request, ann).startConversation(ben.username)
    await as(request, ann).sendMessage(id, 'old message one')
    await as(request, ben).sendMessage(id, 'old message two')
    await as(request, ann).sendMessage(id, 'old message three')
    const annPage = await signInAs(browser, ann, `/messages/${id}`)
    await expect(annPage.getByText('old message three')).toBeVisible()
    await signIn(page, ben, `/messages/${id}`)
    await expect(page.getByText('old message three')).toBeVisible()

    await page.getByRole('button', { name: 'Conversation actions' }).click()
    await page.getByRole('menuitem', { name: 'Delete conversation' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete this conversation?' })
    await expect(dialog).toContainText('Ann Keeper keeps their copy and is not told')
    await page.screenshot(shot('conversation-delete-dialog'))
    await dialog.getByRole('button', { name: 'Delete' }).click()

    // Ben: back at the inbox, nothing in it, no unread, and the old address shows an empty chat.
    await expect(page).toHaveURL(/\/messages$/)
    await expect(page.getByText('Conversation deleted.')).toBeVisible()
    await expect(page.getByText('No messages yet')).toBeVisible()
    await expect(messagesLink(page, 'Messages')).toBeVisible()
    await page.goto(`/messages/${id}`)
    await expect(page.getByText('No messages yet. Say hello to Ann Keeper.')).toBeVisible()
    await expect(page.getByText('old message one')).toHaveCount(0)
    // Ann: nothing changed, and nothing told her.
    await expect(annPage.getByText('old message one')).toBeVisible()
    await expect(annPage.getByText('old message two')).toBeVisible()
    await annPage.reload()
    await expect(annPage.getByText('old message three')).toBeVisible()

    // Ann writes again: the conversation comes back for Ben, live, with only the new message.
    await page.goto('/messages')
    await expect(page.getByText('No messages yet')).toBeVisible()
    await annPage.getByRole('textbox', { name: 'Message' }).fill('hello again after you deleted')
    await annPage.getByRole('textbox', { name: 'Message' }).press('Enter')
    const row = page.getByRole('link', { name: 'Conversation with Ann Keeper, 1 unread' })
    await expect(row).toContainText('hello again after you deleted')
    await expect(messagesLink(page, 'Messages (1 unread)')).toBeVisible()
    await row.click()
    await expect(page.getByText('hello again after you deleted')).toBeVisible()
    await expect(page.getByText('old message one')).toHaveCount(0)
    await expect(page.getByText('old message three')).toHaveCount(0)
    const history = JSON.stringify(await as(request, ben).get(`/api/conversations/${id}/messages`))
    expect(history).toContain('hello again after you deleted')
    expect(history).not.toContain('old message')
    await page.screenshot(shot('conversation-back-with-new'))
  })

  test('a deleted message cannot be edited, and the menu is there for the keyboard too', async ({ page, request }) => {
    const ann = await createUser(request)
    const ben = await createUser(request)
    const { id } = await as(request, ann).startConversation(ben.username)
    await as(request, ann).sendMessage(id, 'keyboard message')
    await signIn(page, ann, `/messages/${id}`)
    await expect(page.getByText('keyboard message')).toBeVisible()

    const trigger = page.getByRole('button', { name: 'Message actions' })
    await trigger.focus()
    await expect(trigger).toBeVisible()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter') // the first item: Edit
    await expect(page.getByRole('textbox', { name: 'Edit message' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('textbox', { name: 'Edit message' })).toHaveCount(0)
    await expect(page.getByText('keyboard message')).toBeVisible()

    const messageId = (await as(request, ann).get(`/api/conversations/${id}/messages`)).items[0].id
    await as(request, ann).deleteMessage(id, messageId)
    const edit = await request.patch(`/api/conversations/${id}/messages/${messageId}`, { headers: { Authorization: `Bearer ${ann.accessToken}` }, data: { content: 'back again' } })
    expect(edit.status()).toBe(409)
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
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true })

  test('on a touch screen the edit / delete menu is shown without hovering', async ({ page, request }) => {
    const me = await createUser(request)
    const friend = await createUser(request)
    const { id } = await as(request, me).startConversation(friend.username)
    await as(request, me).sendMessage(id, 'tap my menu')
    await signIn(page, me, `/messages/${id}`)
    await expect(page.getByText('tap my menu')).toBeVisible()
    const trigger = page.getByRole('button', { name: 'Message actions' })
    await expect(trigger).toHaveCSS('opacity', '1')
    await trigger.tap()
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot(shot('messages-phone-menu'))
  })

  test('on a phone the conversation can be deleted from the header menu', async ({ page, request }) => {
    const me = await createUser(request)
    const friend = await createUser(request)
    const { id } = await as(request, me).startConversation(friend.username)
    await as(request, friend).sendMessage(id, 'phone message')
    await signIn(page, me, `/messages/${id}`)
    await expect(page.getByText('phone message')).toBeVisible()

    await page.getByRole('button', { name: 'Conversation actions' }).tap()
    await page.getByRole('menuitem', { name: 'Delete conversation' }).tap()
    await page.getByRole('dialog', { name: 'Delete this conversation?' }).getByRole('button', { name: 'Delete' }).tap()

    await expect(page).toHaveURL(/\/messages$/)
    await expect(page.getByText('No messages yet')).toBeVisible()
  })

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
