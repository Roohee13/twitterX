import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { PostResponse } from '../../lib/types'
import { makePost, makeUser } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { ComposeProvider } from '../compose/ComposeContext'
import { HomePage } from '../home/HomePage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
  localStorage.setItem('xclone.homeTab', 'following') // these tests are about the Following timeline; Home opens on "For you" by default
})
afterEach(() => {
  server.resetHandlers()
  vi.unstubAllGlobals()
})

const mine = makeUser({ id: 1, username: 'alice', displayName: 'Alice' }) // the signed-in user in renderSignedIn

async function showTimeline(...posts: PostResponse[]) {
  server.use(http.get(`${BASE}/api/timeline`, () => HttpResponse.json({ items: posts, nextCursor: null })))
  renderSignedIn(
    <ComposeProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/post/:id" element={<p>post page</p>} />
      </Routes>
    </ComposeProvider>,
  )
  await screen.findAllByRole('article')
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const menuItem = (name: string) => screen.getByRole('menuitem', { name })

describe('like', () => {
  it('shows the like at once, before the server has answered, and can be undone', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const calls: string[] = []
    server.use(
      http.post(`${BASE}/api/posts/5/like`, async () => (calls.push('POST'), await gate, new HttpResponse(null, { status: 204 }))),
      http.delete(`${BASE}/api/posts/5/like`, () => (calls.push('DELETE'), new HttpResponse(null, { status: 204 }))),
    )
    await showTimeline(makePost({ id: 5, likeCount: 2 }))

    await userEvent.click(button('Like'))

    const unlike = screen.getByRole('button', { name: 'Unlike' })
    expect(unlike).toHaveAttribute('aria-pressed', 'true')
    expect(unlike).toHaveTextContent('3')
    release()
    await waitFor(() => expect(calls).toEqual(['POST']))

    await userEvent.click(unlike)
    expect(screen.getByRole('button', { name: 'Like' })).toHaveTextContent('2')
    await waitFor(() => expect(calls).toEqual(['POST', 'DELETE']))
  })

  it('goes back and says why when the server refuses', async () => {
    server.use(http.post(`${BASE}/api/posts/5/like`, () => HttpResponse.json({ status: 403, detail: 'This action is not allowed because of a block' }, { status: 403 })))
    await showTimeline(makePost({ id: 5, likeCount: 2 }))

    await userEvent.click(button('Like'))

    expect(await screen.findByText('This action is not allowed because of a block')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Like' })).toHaveTextContent('2')
  })

  it('ignores a second click while the first is still being sent', async () => {
    const calls = vi.fn()
    server.use(http.post(`${BASE}/api/posts/5/like`, async () => (calls(), await new Promise((r) => setTimeout(r, 50)), new HttpResponse(null, { status: 204 }))))
    await showTimeline(makePost({ id: 5 }))

    await userEvent.dblClick(button('Like'))

    await waitFor(() => expect(calls).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Unlike' })).toHaveTextContent('1')
  })

  it('updates every copy of the same post (a repost row and the original)', async () => {
    server.use(http.post(`${BASE}/api/posts/9/like`, () => new HttpResponse(null, { status: 204 })))
    const original = makePost({ id: 9, likeCount: 4 })
    await showTimeline(original, { ...original, repostedBy: makeUser({ id: 50, displayName: 'Rita' }) })

    await userEvent.click(screen.getAllByRole('button', { name: 'Like' })[0])

    for (const unlike of screen.getAllByRole('button', { name: 'Unlike' })) expect(unlike).toHaveTextContent('5')
    expect(screen.getAllByRole('button', { name: 'Unlike' })).toHaveLength(2)
  })
})

describe('repost and quote', () => {
  it('reposts and undoes it from the menu', async () => {
    const calls: string[] = []
    server.use(
      http.post(`${BASE}/api/posts/6/repost`, () => (calls.push('POST'), new HttpResponse(null, { status: 204 }))),
      http.delete(`${BASE}/api/posts/6/repost`, () => (calls.push('DELETE'), new HttpResponse(null, { status: 204 }))),
    )
    await showTimeline(makePost({ id: 6, repostCount: 0 }))

    await userEvent.click(button('Repost'))
    await userEvent.click(menuItem('Repost'))

    const reposted = await screen.findByRole('button', { name: 'Repost (you reposted this)' })
    expect(reposted).toHaveAttribute('aria-pressed', 'true')
    expect(reposted).toHaveTextContent('1')
    await userEvent.click(reposted)
    await userEvent.click(menuItem('Undo repost'))
    await waitFor(() => expect(calls).toEqual(['POST', 'DELETE']))
    expect(screen.getByRole('button', { name: 'Repost' })).toHaveAttribute('aria-pressed', 'false')
  })

  it("cannot repost your own post, but can still quote it", async () => {
    await showTimeline(makePost({ id: 7, author: mine }))
    await userEvent.click(button('Repost'))
    expect(menuItem('Repost')).toBeDisabled()
    expect(menuItem('Quote')).toBeEnabled()
  })

  it('cannot repost or quote a protected account\'s post', async () => {
    await showTimeline(makePost({ id: 8, author: makeUser({ protectedAccount: true }) }))
    await userEvent.click(button('Repost'))
    expect(menuItem('Repost')).toBeDisabled()
    expect(menuItem('Quote')).toBeDisabled()
  })

  it('quotes a post through the composer dialog', async () => {
    let body: Record<string, unknown> = {}
    server.use(http.post(`${BASE}/api/posts`, async ({ request }) => ((body = (await request.json()) as typeof body), HttpResponse.json(makePost({ id: 77, content: 'my comment' }), { status: 201 }))))
    await showTimeline(makePost({ id: 4, content: 'quote me' }))

    await userEvent.click(button('Repost'))
    await userEvent.click(menuItem('Quote'))
    const dialog = await screen.findByRole('dialog', { name: 'Quote' })
    expect(within(dialog).getByRole('group', { name: 'Quoting Bob Builder' })).toHaveTextContent('quote me')
    await userEvent.type(within(dialog).getByRole('textbox'), 'my comment')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(body).toEqual({ content: 'my comment', quotedPostId: 4 }))
    expect(await screen.findByText('Your post was sent.')).toBeInTheDocument()
  })
})

describe('reply', () => {
  it('replies through a dialog and bumps the reply count', async () => {
    let body: Record<string, unknown> = {}
    server.use(http.post(`${BASE}/api/posts`, async ({ request }) => ((body = (await request.json()) as typeof body), HttpResponse.json(makePost({ id: 88 }), { status: 201 }))))
    await showTimeline(makePost({ id: 3, content: 'a question', replyCount: 0 }))

    await userEvent.click(button('Reply'))
    const dialog = await screen.findByRole('dialog', { name: 'Reply' })
    await userEvent.type(within(dialog).getByRole('textbox'), 'an answer')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reply' }))

    await waitFor(() => expect(body).toEqual({ content: 'an answer', replyToId: 3 }))
    expect(await screen.findByText('Your reply was sent.')).toBeInTheDocument()
    expect(within(screen.getByRole('article')).getByRole('button', { name: 'Reply' })).toHaveTextContent('1')
  })

  it("is disabled, with the reason, when the author limits who can reply", async () => {
    await showTimeline(makePost({ canReply: false }))
    const reply = button('Replies are limited by the author')
    expect(reply).toBeDisabled()
    expect(reply).toHaveAttribute('title', 'The author limits who can reply')
  })
})

describe('bookmark and share', () => {
  it('bookmarks and removes the bookmark', async () => {
    const calls: string[] = []
    server.use(
      http.post(`${BASE}/api/posts/2/bookmark`, () => (calls.push('POST'), new HttpResponse(null, { status: 204 }))),
      http.delete(`${BASE}/api/posts/2/bookmark`, () => (calls.push('DELETE'), new HttpResponse(null, { status: 204 }))),
    )
    await showTimeline(makePost({ id: 2 }))

    await userEvent.click(button('Bookmark'))
    expect(screen.getByRole('button', { name: 'Remove bookmark' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(button('Remove bookmark'))

    await waitFor(() => expect(calls).toEqual(['POST', 'DELETE']))
    expect(screen.getByRole('button', { name: 'Bookmark' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('treats "already bookmarked" as done instead of an error', async () => {
    server.use(http.post(`${BASE}/api/posts/2/bookmark`, () => HttpResponse.json({ status: 409, detail: 'You have already bookmarked this post' }, { status: 409 })))
    await showTimeline(makePost({ id: 2 }))

    await userEvent.click(button('Bookmark'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove bookmark' })).toBeInTheDocument())
    expect(screen.queryByText('You have already bookmarked this post')).not.toBeInTheDocument()
  })

  it('undoes a bookmark the server refused', async () => {
    server.use(http.post(`${BASE}/api/posts/2/bookmark`, () => HttpResponse.json({ status: 500, detail: 'Boom' }, { status: 500 })))
    await showTimeline(makePost({ id: 2 }))

    await userEvent.click(button('Bookmark'))

    expect(await screen.findByText('Boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bookmark' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('copies the link to the post', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await showTimeline(makePost({ id: 31 }))

    await userEvent.click(button('Copy link to post'))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/post/31`)
    expect(await screen.findByText('Link copied to clipboard.')).toBeInTheDocument()
  })
})

describe('the "more" menu', () => {
  it('offers edit, who-can-reply and delete on your own top-level post', async () => {
    await showTimeline(makePost({ author: mine }))
    await userEvent.click(button('More actions'))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit post', 'Who can reply', 'Delete post'])
  })

  it('leaves out who-can-reply on your own reply', async () => {
    await showTimeline(makePost({ author: mine, replyToId: 12 }))
    await userEvent.click(button('More actions'))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit post', 'Delete post'])
  })

  it("offers only report on someone else's post", async () => {
    await showTimeline(makePost())
    await userEvent.click(button('More actions'))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Report post'])
  })

  it('closes with Escape and keeps keyboard focus on its button', async () => {
    await showTimeline(makePost())
    const more = button('More actions')
    await userEvent.click(more)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(more).toHaveFocus()
  })

  it('edits a post', async () => {
    let body: unknown
    server.use(http.patch(`${BASE}/api/posts/10`, async ({ request }) => ((body = await request.json()), HttpResponse.json(makePost({ id: 10, content: 'fixed text' })))))
    await showTimeline(makePost({ id: 10, author: mine, content: 'typo text' }))

    await userEvent.click(button('More actions'))
    await userEvent.click(menuItem('Edit post'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit post' })
    const box = within(dialog).getByRole('textbox')
    expect(box).toHaveValue('typo text')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled() // nothing changed yet
    await userEvent.clear(box)
    await userEvent.type(box, 'fixed text')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(body).toEqual({ content: 'fixed text' }))
    expect(await screen.findByText('Your post was updated.')).toBeInTheDocument()
    expect(within(screen.getByRole('article')).getByText('fixed text')).toBeInTheDocument()
  })

  it('deletes a post after confirming, and it disappears', async () => {
    const deleted = vi.fn()
    server.use(http.delete(`${BASE}/api/posts/11`, () => (deleted(), new HttpResponse(null, { status: 204 }))))
    await showTimeline(makePost({ id: 11, author: mine, content: 'to be removed' }), makePost({ id: 12, content: 'stays' }))

    await userEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0])
    await userEvent.click(menuItem('Delete post'))
    const dialog = await screen.findByRole('dialog', { name: 'Delete post?' })
    expect(deleted).not.toHaveBeenCalled() // asking first
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('to be removed')).not.toBeInTheDocument())
    expect(screen.getByText('stays')).toBeInTheDocument()
    expect(deleted).toHaveBeenCalledTimes(1)
  })

  it('reports a post with a reason, and takes "already reported" calmly', async () => {
    const bodies: unknown[] = []
    let first = true
    server.use(
      http.post(`${BASE}/api/posts/13/report`, async ({ request }) => {
        bodies.push(await request.json())
        const conflict = !first
        first = false
        return conflict ? HttpResponse.json({ status: 409, detail: 'You have already reported this post' }, { status: 409 }) : new HttpResponse(null, { status: 204 })
      }),
    )
    await showTimeline(makePost({ id: 13 }))

    await userEvent.click(button('More actions'))
    await userEvent.click(menuItem('Report post'))
    let dialog = await screen.findByRole('dialog', { name: 'Report post' })
    expect(within(dialog).getByRole('button', { name: 'Report' })).toBeDisabled() // pick a reason first
    await userEvent.click(within(dialog).getByLabelText("It's spam"))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Report' }))
    expect(await screen.findByText(/Thanks for letting us know/)).toBeInTheDocument()

    await userEvent.click(button('More actions'))
    await userEvent.click(menuItem('Report post'))
    dialog = await screen.findByRole('dialog', { name: 'Report post' })
    await userEvent.click(within(dialog).getByLabelText('Something else'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Report' }))
    expect(await screen.findByText('You already reported this post.')).toBeInTheDocument()
    expect(bodies).toEqual([{ reason: 'SPAM' }, { reason: 'OTHER' }])
  })

  it('changes who can reply', async () => {
    let body: unknown
    server.use(http.patch(`${BASE}/api/posts/14/reply-policy`, async ({ request }) => ((body = await request.json()), HttpResponse.json(makePost({ id: 14, replyPolicy: 'FOLLOWING', canReply: true })))))
    await showTimeline(makePost({ id: 14, author: mine }))

    await userEvent.click(button('More actions'))
    await userEvent.click(menuItem('Who can reply'))
    const dialog = await screen.findByRole('dialog', { name: 'Who can reply?' })
    expect(within(dialog).getByLabelText(/^Everyone/)).toBeChecked()
    await userEvent.click(within(dialog).getByLabelText(/People you follow/))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(body).toEqual({ replyPolicy: 'FOLLOWING' }))
    expect(await screen.findByText('Who can reply was updated.')).toBeInTheDocument()
  })
})

describe('opening a post', () => {
  it('opens the post when the card is clicked', async () => {
    await showTimeline(makePost({ id: 55, content: 'click the empty part' }))
    await userEvent.click(screen.getByRole('article'))
    expect(await screen.findByText('post page')).toBeInTheDocument()
  })

  it('does not open the post when a link or button inside it is used', async () => {
    server.use(http.post(`${BASE}/api/posts/56/like`, () => new HttpResponse(null, { status: 204 })))
    await showTimeline(makePost({ id: 56, content: 'with #tag' }))

    await userEvent.click(button('Like'))
    await userEvent.click(button('More actions'))
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByText('post page')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: '#tag' }))
    expect(screen.queryByText('post page')).not.toBeInTheDocument()
  })
})
