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
import { PostPage } from './PostPage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const mine = makeUser({ id: 1, username: 'alice', displayName: 'Alice' })
const page = <T,>(items: T[] = [], nextCursor: number | null = null) => HttpResponse.json({ items, nextCursor })

/** Serves the post and its related endpoints; individual tests override what they care about. */
function serve(post: PostResponse, extra: { replies?: PostResponse[]; thread?: PostResponse[] } = {}) {
  server.use(
    http.get(`${BASE}/api/posts/${post.id}`, () => HttpResponse.json(post)),
    http.get(`${BASE}/api/posts/${post.id}/replies`, () => page(extra.replies ?? [])),
    http.get(`${BASE}/api/posts/${post.id}/thread`, () => HttpResponse.json(extra.thread ?? [post])),
  )
}

function open(path: string) {
  return renderSignedIn(
    <ComposeProvider>
      <Routes>
        <Route path="/post/:id" element={<PostPage />} />
        <Route path="/" element={<p>home page</p>} />
        <Route path="/u/:username" element={<p>profile page</p>} />
      </Routes>
    </ComposeProvider>,
    { route: path },
  )
}

describe('PostPage', () => {
  it('shows the post large, with its full date, its counts and its replies oldest first', async () => {
    const post = makePost({ id: 5, content: 'the focused post', repostCount: 1, likeCount: 3, replyCount: 2, createdAt: '2026-03-04T10:30:00Z' })
    serve(post, { replies: [makePost({ id: 6, content: 'first reply' }), makePost({ id: 7, content: 'second reply' })] })

    open('/post/5')

    const focused = await screen.findByRole('article', { name: 'Post by Bob Builder' })
    expect(within(focused).getByText('the focused post')).toBeInTheDocument()
    expect(within(focused).getByText(/Mar 4, 2026/)).toBeInTheDocument()
    expect(within(focused).getByRole('group', { name: 'Post statistics' })).toHaveTextContent('1 Repost3 Likes2 Replies')
    await screen.findByText('second reply')
    const order = screen.getAllByRole('article').map((a) => a.textContent ?? '')
    expect(order.findIndex((t) => t.includes('first reply'))).toBeLessThan(order.findIndex((t) => t.includes('second reply')))
  })

  it('replies from the page, and the new reply appears with the count updated', async () => {
    const post = makePost({ id: 5, replyCount: 0 })
    let replies: PostResponse[] = []
    serve(post)
    server.use(
      http.get(`${BASE}/api/posts/5/replies`, () => page(replies)),
      http.post(`${BASE}/api/posts`, async ({ request }) => {
        const body = (await request.json()) as { content: string; replyToId: number }
        expect(body.replyToId).toBe(5)
        replies = [makePost({ id: 9, content: body.content, author: mine })]
        return HttpResponse.json(replies[0], { status: 201 })
      }),
    )
    open('/post/5')

    await userEvent.type(await screen.findByRole('textbox', { name: 'Post text' }), 'my answer')
    await userEvent.click(screen.getByRole('button', { name: 'Post reply' }))

    expect(await screen.findByText('Your reply was sent.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('my answer')).toHaveLength(1)) // the reply, listed once the list is refetched
    expect(within(screen.getByRole('article', { name: 'Post by Bob Builder' })).getByRole('group', { name: 'Post statistics' })).toHaveTextContent('1 Reply')
  })

  it.each([
    ['FOLLOWING', /Only accounts the author follows can reply/],
    ['MENTIONED', /Only accounts mentioned in this conversation can reply/],
  ] as const)('explains a %s limit instead of showing the reply box', async (replyPolicy, text) => {
    serve(makePost({ id: 5, canReply: false, replyPolicy }))
    open('/post/5')

    expect(await screen.findByText(/The author limits who can reply/)).toBeInTheDocument()
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Post text' })).not.toBeInTheDocument()
  })

  it('says so when there are no replies yet', async () => {
    serve(makePost({ id: 5 }))
    open('/post/5')
    expect(await screen.findByText('Be the first to reply.')).toBeInTheDocument()
  })
})

describe('PostPage: posts that cannot be shown', () => {
  it('a deleted or unknown post', async () => {
    server.use(http.get(`${BASE}/api/posts/404`, () => HttpResponse.json({ status: 404, detail: 'Post not found' }, { status: 404 })))
    open('/post/404')
    expect(await screen.findByText("This post doesn't exist")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/')
  })

  it("a protected account's post", async () => {
    server.use(http.get(`${BASE}/api/posts/403`, () => HttpResponse.json({ status: 403, detail: 'This account is protected' }, { status: 403 })))
    open('/post/403')
    expect(await screen.findByText('These posts are protected')).toBeInTheDocument()
  })

  it('a post hidden by a block gives the server reason', async () => {
    server.use(http.get(`${BASE}/api/posts/403`, () => HttpResponse.json({ status: 403, detail: 'This action is not allowed because of a block' }, { status: 403 })))
    open('/post/403')
    expect(await screen.findByText("You can't view this post")).toBeInTheDocument()
    expect(screen.getByText('This action is not allowed because of a block')).toBeInTheDocument()
  })

  it('an address that is not a post id never asks the server', async () => {
    const asked = vi.fn()
    server.use(http.get(`${BASE}/api/posts/:id`, () => (asked(), HttpResponse.json({}))))
    open('/post/not-a-number')
    expect(await screen.findByText("This post doesn't exist")).toBeInTheDocument()
    expect(asked).not.toHaveBeenCalled()
  })
})

describe('PostPage: context', () => {
  it('shows the post a reply answers, above it', async () => {
    const parent = makePost({ id: 4, content: 'the question' })
    const reply = makePost({ id: 5, content: 'the answer', replyToId: 4 })
    serve(reply)
    server.use(http.get(`${BASE}/api/posts/4`, () => HttpResponse.json(parent)))

    open('/post/5')

    await screen.findByText('the question')
    const articles = screen.getAllByRole('article')
    expect(articles[0]).toHaveTextContent('the question')
    expect(articles[1]).toHaveTextContent('the answer')
  })

  it('shows a short note when the post it answers cannot be shown', async () => {
    serve(makePost({ id: 5, replyToId: 4 }))
    server.use(http.get(`${BASE}/api/posts/4`, () => HttpResponse.json({ status: 404, detail: 'Post not found' }, { status: 404 })))
    open('/post/5')
    expect(await screen.findByText('The post this replies to is unavailable.')).toBeInTheDocument()
  })

  it("shows the author's own follow-ups under a post, and not again in the replies", async () => {
    const root = makePost({ id: 5, content: 'thread start' })
    const second = makePost({ id: 6, content: 'thread part two', replyToId: 5 })
    const other = makePost({ id: 7, content: 'someone elses reply', replyToId: 5, author: makeUser({ id: 30, displayName: 'Other' }) })
    serve(root, { thread: [root, second], replies: [second, other] })

    open('/post/5')

    const more = await screen.findByRole('region', { name: 'More from the author' })
    expect(more).toHaveTextContent('thread part two')
    await screen.findByText('someone elses reply')
    expect(screen.getAllByText('thread part two')).toHaveLength(1)
  })
})

describe('PostPage: likes and your own post', () => {
  it('lists the people who liked it', async () => {
    serve(makePost({ id: 5, likeCount: 2 }))
    server.use(http.get(`${BASE}/api/posts/5/likes`, () => page([makeUser({ id: 21, username: 'fan_one', displayName: 'Fan One' }), makeUser({ id: 22, username: 'fan_two', displayName: 'Fan Two' })])))
    open('/post/5')

    await userEvent.click(await screen.findByRole('button', { name: '2 Likes' }))

    const dialog = await screen.findByRole('dialog', { name: 'Liked by' })
    expect(within(dialog).getByRole('link', { name: /Fan One/ })).toHaveAttribute('href', '/u/fan_one')
    expect(within(dialog).getByRole('link', { name: /Fan Two/ })).toBeInTheDocument()
  })

  it('lists the people who reposted it, and an unavailable account is a plain row', async () => {
    serve(makePost({ id: 5, repostCount: 2 }))
    server.use(http.get(`${BASE}/api/posts/5/reposts`, () => page([makeUser({ id: 31, username: 'sharer_one', displayName: 'Sharer One' }), makeUser({ id: 32, username: '', displayName: 'XClone user', unavailable: true })])))
    open('/post/5')

    await userEvent.click(await screen.findByRole('button', { name: '2 Reposts' }))

    const dialog = await screen.findByRole('dialog', { name: 'Reposted by' })
    expect(within(dialog).getByRole('link', { name: /Sharer One/ })).toHaveAttribute('href', '/u/sharer_one')
    expect(within(dialog).getByText('XClone user')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('link')).toHaveLength(1)
  })

  it('has no reposters list when nobody reposted it', async () => {
    serve(makePost({ id: 5, repostCount: 0 }))
    open('/post/5')
    await screen.findByRole('article', { name: 'Post by Bob Builder' })
    expect(screen.queryByRole('button', { name: /^\d+ Reposts?$/ })).not.toBeInTheDocument()
  })

  it('has no likers list when nobody liked it', async () => {
    serve(makePost({ id: 5, likeCount: 0 }))
    open('/post/5')
    await screen.findByRole('article', { name: 'Post by Bob Builder' })
    expect(screen.queryByRole('button', { name: /^\d+ Likes?$/ })).not.toBeInTheDocument()
  })

  it('goes back home after you delete your own post', async () => {
    serve(makePost({ id: 5, author: mine }))
    server.use(http.delete(`${BASE}/api/posts/5`, () => new HttpResponse(null, { status: 204 })))
    open('/post/5')

    await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete post' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete post?' })).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('home page')).toBeInTheDocument()
  })
})
