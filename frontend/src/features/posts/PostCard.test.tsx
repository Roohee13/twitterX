import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makePost, makeUser } from '../../test/fixtures'
import { renderSignedIn, server } from '../../test/render'
import { beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { BASE } from '../../test/render'
import type { PostResponse } from '../../lib/types'
import { PostCard } from './PostCard'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

async function show(post: PostResponse) {
  const view = renderSignedIn(<PostCard post={post} />)
  await screen.findByRole('article')
  return view
}

describe('PostCard video', () => {
  it('plays a video with controls instead of showing an image', async () => {
    await show(makePost({ mediaUrls: ['https://media.test/users/1/clip.mp4'] }))
    const video = screen.getByLabelText('Video attached to the post')
    expect(video.tagName).toBe('VIDEO')
    expect(video).toHaveAttribute('src', 'https://media.test/users/1/clip.mp4')
    expect(video).toHaveAttribute('controls')
    expect(screen.queryByAltText('Image attached to the post')).not.toBeInTheDocument()
  })
})

describe('PostCard', () => {
  it('shows who posted, their handle, how long ago, and the text', async () => {
    await show(makePost({ content: 'hello world', author: makeUser({ displayName: 'Ada Lovelace', username: 'ada' }) }))

    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/u/ada')
    expect(screen.getByText('@ada')).toBeInTheDocument()
    expect(screen.getByText('5m')).toBeInTheDocument()
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('links the time to the post itself', async () => {
    await show(makePost({ id: 321 }))
    expect(screen.getByRole('link', { name: '5m' })).toHaveAttribute('href', '/post/321')
  })

  it('marks protected accounts with a lock', async () => {
    await show(makePost({ author: makeUser({ protectedAccount: true }) }))
    expect(screen.getByLabelText('Protected account')).toBeInTheDocument()
  })

  it('has no lock for public accounts', async () => {
    await show(makePost())
    expect(screen.queryByLabelText('Protected account')).not.toBeInTheDocument()
  })

  it('links hashtags, resolved mentions and web addresses', async () => {
    await show(makePost({ content: 'Hi @carol_k and @ghost_x #React https://example.com/docs.', mentions: [makeUser({ username: 'carol_k' })] }))

    expect(screen.getByRole('link', { name: '#React' })).toHaveAttribute('href', '/hashtag/react')
    expect(screen.getByRole('link', { name: '@carol_k' })).toHaveAttribute('href', '/u/carol_k')
    expect(screen.queryByRole('link', { name: '@ghost_x' })).not.toBeInTheDocument()
    const external = screen.getByRole('link', { name: 'example.com/docs' })
    expect(external).toHaveAttribute('href', 'https://example.com/docs')
    expect(external).toHaveAttribute('target', '_blank')
    expect(external.getAttribute('rel')).toContain('noopener')
  })

  it('shows markup in a post as text instead of running it', async () => {
    const { container } = await show(makePost({ content: '<img src=x onerror=alert(1)> <script>alert(2)</script>' }))

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
  })

  it('keeps line breaks and wraps very long words', async () => {
    await show(makePost({ content: 'first line\nsecond line' }))
    expect(screen.getByText(/first line/)).toHaveClass('whitespace-pre-wrap', 'break-words')
  })

  it('says who reposted it', async () => {
    await show(makePost({ repostedBy: makeUser({ id: 22, username: 'dana', displayName: 'Dana' }) }))
    const note = screen.getByText(/reposted/)
    expect(within(note).getByRole('link', { name: 'Dana' })).toHaveAttribute('href', '/u/dana')
  })

  it('embeds a quoted post', async () => {
    await show(makePost({ content: 'my take', quotedPost: makePost({ content: 'the original', author: makeUser({ displayName: 'Orin' }) }) }))
    const quoted = screen.getByRole('group', { name: 'Quoted post by Orin' })
    expect(within(quoted).getByText('the original')).toBeInTheDocument()
  })

  it.each([1, 2, 3, 4])('shows %i attached image(s)', async (count) => {
    const urls = Array.from({ length: count }, (_, i) => `https://media.test/${i}.png`)
    await show(makePost({ mediaUrls: urls }))
    expect(screen.getAllByAltText(/attached to the post/)).toHaveLength(count)
  })

  it('shows at most four images', async () => {
    await show(makePost({ mediaUrls: Array.from({ length: 6 }, (_, i) => `https://media.test/${i}.png`) }))
    expect(screen.getAllByAltText(/attached to the post/)).toHaveLength(4)
  })

  it('shows the counts next to the buttons, and nothing for zero', async () => {
    await show(makePost({ replyCount: 1, repostCount: 0, likeCount: 12 }))
    expect(within(screen.getByRole('button', { name: 'Reply' })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Like' })).getByText('12')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repost' })).toHaveTextContent('')
  })
})
