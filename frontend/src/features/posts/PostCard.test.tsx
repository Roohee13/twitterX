import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { makePost, makeUser } from '../../test/fixtures'
import type { PostResponse } from '../../lib/types'
import { PostCard } from './PostCard'

const show = (post: PostResponse) =>
  render(
    <MemoryRouter>
      <PostCard post={post} />
    </MemoryRouter>,
  )

describe('PostCard', () => {
  it('shows who posted, their handle, how long ago, and the text', () => {
    show(makePost({ content: 'hello world', author: makeUser({ displayName: 'Ada Lovelace', username: 'ada' }) }))

    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/u/ada')
    expect(screen.getByText('@ada')).toBeInTheDocument()
    expect(screen.getByText('5m')).toBeInTheDocument()
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('marks protected accounts with a lock', () => {
    show(makePost({ author: makeUser({ protectedAccount: true }) }))
    expect(screen.getByLabelText('Protected account')).toBeInTheDocument()
  })

  it('has no lock for public accounts', () => {
    show(makePost())
    expect(screen.queryByLabelText('Protected account')).not.toBeInTheDocument()
  })

  it('links hashtags, resolved mentions and web addresses', () => {
    show(makePost({ content: 'Hi @carol_k and @ghost_x #React https://example.com/docs.', mentions: [makeUser({ username: 'carol_k' })] }))

    expect(screen.getByRole('link', { name: '#React' })).toHaveAttribute('href', '/hashtag/react')
    expect(screen.getByRole('link', { name: '@carol_k' })).toHaveAttribute('href', '/u/carol_k')
    expect(screen.queryByRole('link', { name: '@ghost_x' })).not.toBeInTheDocument()
    const external = screen.getByRole('link', { name: 'example.com/docs' })
    expect(external).toHaveAttribute('href', 'https://example.com/docs')
    expect(external).toHaveAttribute('target', '_blank')
    expect(external.getAttribute('rel')).toContain('noopener')
  })

  it('shows markup in a post as text instead of running it', () => {
    const { container } = show(makePost({ content: '<img src=x onerror=alert(1)> <script>alert(2)</script>' }))

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
  })

  it('keeps line breaks and wraps very long words', () => {
    show(makePost({ content: 'first line\nsecond line' }))
    const paragraph = screen.getByText(/first line/)
    expect(paragraph).toHaveClass('whitespace-pre-wrap', 'break-words')
  })

  it('says who reposted it', () => {
    show(makePost({ repostedBy: makeUser({ id: 22, username: 'dana', displayName: 'Dana' }) }))
    const note = screen.getByText(/reposted/)
    expect(within(note).getByRole('link', { name: 'Dana' })).toHaveAttribute('href', '/u/dana')
  })

  it('embeds a quoted post', () => {
    show(makePost({ content: 'my take', quotedPost: makePost({ content: 'the original', author: makeUser({ displayName: 'Orin' }) }) }))
    const quoted = screen.getByRole('group', { name: 'Quoted post by Orin' })
    expect(within(quoted).getByText('the original')).toBeInTheDocument()
  })

  it.each([1, 2, 3, 4])('shows %i attached image(s)', (count) => {
    const urls = Array.from({ length: count }, (_, i) => `https://media.test/${i}.png`)
    show(makePost({ mediaUrls: urls }))
    expect(screen.getAllByRole('img')).toHaveLength(count)
  })

  it('shows at most four images', () => {
    show(makePost({ mediaUrls: Array.from({ length: 6 }, (_, i) => `https://media.test/${i}.png`) }))
    expect(screen.getAllByRole('img')).toHaveLength(4)
  })

  it('reports the counts accessibly, with correct singular and plural', () => {
    show(makePost({ replyCount: 1, repostCount: 0, likeCount: 12 }))
    expect(screen.getByLabelText('1 reply')).toBeInTheDocument()
    expect(screen.getByLabelText('0 reposts')).toBeInTheDocument()
    expect(screen.getByLabelText('12 likes')).toBeInTheDocument()
  })
})
