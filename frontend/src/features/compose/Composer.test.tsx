import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { makePost } from '../../test/fixtures'
import { BASE, renderSignedIn, server } from '../../test/render'
import { Composer } from './Composer'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const postButton = () => screen.getByRole('button', { name: /^(Post|Reply|Post all)$/ })
const textbox = () => screen.getByRole('textbox')
const png = (name = 'cat.png', type = 'image/png') => new File([new Uint8Array(64)], name, { type })

/** Handlers for a working upload: presigned URL, then the PUT to storage. */
function uploadHandlers(options: { delay?: Promise<void>; key?: string } = {}) {
  let n = 0
  return [
    http.post(`${BASE}/api/media/upload-url`, () => {
      n += 1
      return HttpResponse.json({ key: `users/1/${options.key ?? 'img'}${n}.png`, uploadUrl: `https://r2.test/up${n}`, headers: { 'content-type': ['image/png'] }, publicUrl: `https://media.test/img${n}.png`, expiresAt: 'x' })
    }),
    http.put(/https:\/\/r2\.test\/up\d/, async () => {
      await options.delay
      return new HttpResponse(null, { status: 200 })
    }),
  ]
}

describe('Composer: text', () => {
  it('cannot post an empty or whitespace-only post', async () => {
    renderSignedIn(<Composer />)
    await screen.findByRole('textbox')
    expect(postButton()).toBeDisabled()
    await userEvent.type(textbox(), '   ')
    expect(postButton()).toBeDisabled()
    await userEvent.type(textbox(), 'hi')
    expect(postButton()).toBeEnabled()
  })

  it('counts characters, warns near the limit and blocks posting over it', async () => {
    renderSignedIn(<Composer />)
    await userEvent.type(await screen.findByRole('textbox'), 'a'.repeat(5))
    expect(screen.getByLabelText('275 characters left')).toBeInTheDocument()

    await userEvent.clear(textbox())
    await userEvent.click(textbox())
    await userEvent.paste('a'.repeat(281))

    expect(screen.getByLabelText('1 characters over the limit')).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
  })

  it('posts, reports what the server created, and clears the box', async () => {
    let body: unknown
    const created = makePost({ content: 'hello world' })
    server.use(http.post(`${BASE}/api/posts`, async ({ request }) => ((body = await request.json()), HttpResponse.json(created, { status: 201 }))))
    const onPosted = vi.fn()
    renderSignedIn(<Composer onPosted={onPosted} />)

    await userEvent.type(await screen.findByRole('textbox'), '  hello world  ')
    await userEvent.click(postButton())

    await waitFor(() => expect(onPosted).toHaveBeenCalledWith([created]))
    expect(body).toEqual({ content: 'hello world', replyPolicy: 'EVERYONE' })
    expect(textbox()).toHaveValue('')
  })

  it('sends the chosen reply policy', async () => {
    let body: { replyPolicy?: string } = {}
    server.use(http.post(`${BASE}/api/posts`, async ({ request }) => ((body = (await request.json()) as typeof body), HttpResponse.json(makePost(), { status: 201 }))))
    renderSignedIn(<Composer />)

    await userEvent.type(await screen.findByRole('textbox'), 'only for people I follow')
    await userEvent.selectOptions(screen.getByLabelText('Who can reply'), 'FOLLOWING')
    await userEvent.click(postButton())

    await waitFor(() => expect(body.replyPolicy).toBe('FOLLOWING'))
  })

  it('submits with Ctrl+Enter', async () => {
    const posted = vi.fn()
    server.use(http.post(`${BASE}/api/posts`, () => (posted(), HttpResponse.json(makePost(), { status: 201 }))))
    renderSignedIn(<Composer />)

    await userEvent.type(await screen.findByRole('textbox'), 'quick{Control>}{Enter}{/Control}')

    await waitFor(() => expect(posted).toHaveBeenCalledTimes(1))
  })

  it('shows the server message when posting fails and keeps the text', async () => {
    server.use(http.post(`${BASE}/api/posts`, () => HttpResponse.json({ status: 400, detail: 'Validation failed', errors: { content: 'size must be between 0 and 280' } }, { status: 400 })))
    renderSignedIn(<Composer />)

    await userEvent.type(await screen.findByRole('textbox'), 'oops')
    await userEvent.click(postButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('size must be between 0 and 280')
    expect(textbox()).toHaveValue('oops')
    expect(postButton()).toBeEnabled()
  })
})

describe('Composer: replies and quotes', () => {
  it('replies to a post: shows it, sends replyToId, and offers no reply policy', async () => {
    let body: Record<string, unknown> = {}
    const target = makePost({ id: 42, content: 'the original' })
    server.use(http.post(`${BASE}/api/posts`, async ({ request }) => ((body = (await request.json()) as typeof body), HttpResponse.json(makePost(), { status: 201 }))))
    renderSignedIn(<Composer replyTo={target} submitLabel="Reply" />)

    expect(await screen.findByRole('group', { name: 'Replying to Bob Builder' })).toHaveTextContent('the original')
    expect(screen.queryByLabelText('Who can reply')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add another post' })).not.toBeInTheDocument()
    await userEvent.type(textbox(), 'agreed')
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))

    await waitFor(() => expect(body).toEqual({ content: 'agreed', replyToId: 42 }))
  })

  it('quotes a post: shows it and sends quotedPostId', async () => {
    let body: Record<string, unknown> = {}
    server.use(http.post(`${BASE}/api/posts`, async ({ request }) => ((body = (await request.json()) as typeof body), HttpResponse.json(makePost(), { status: 201 }))))
    renderSignedIn(<Composer quoting={makePost({ id: 7, content: 'worth quoting' })} />)

    expect(await screen.findByRole('group', { name: 'Quoting Bob Builder' })).toHaveTextContent('worth quoting')
    await userEvent.type(textbox(), 'my comment')
    await userEvent.click(postButton())

    await waitFor(() => expect(body).toEqual({ content: 'my comment', quotedPostId: 7 }))
  })
})

describe('Composer: images', () => {
  it('uploads a chosen image right away and posts its key', async () => {
    let body: Record<string, unknown> = {}
    server.use(...uploadHandlers(), http.post(`${BASE}/api/posts`, async ({ request }) => ((body = (await request.json()) as typeof body), HttpResponse.json(makePost(), { status: 201 }))))
    renderSignedIn(<Composer />)

    await userEvent.upload(await screen.findByLabelText('Choose images'), png())

    expect(await screen.findByAltText('Selected image preview')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(postButton()).toBeEnabled() // an image alone is enough
    await userEvent.click(postButton())

    await waitFor(() => expect(body).toMatchObject({ content: '', mediaKeys: ['users/1/img1.png'] }))
  })

  it('cannot be posted while an upload is still running', async () => {
    let finish: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { finish = resolve })
    server.use(...uploadHandlers({ delay: gate }))
    renderSignedIn(<Composer />)

    await userEvent.type(await screen.findByRole('textbox'), 'with a picture')
    await userEvent.upload(screen.getByLabelText('Choose images'), png())

    expect(await screen.findByRole('progressbar', { name: 'Uploading image' })).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
    finish()
    await waitFor(() => expect(postButton()).toBeEnabled())
  })

  it('removes an image', async () => {
    server.use(...uploadHandlers())
    renderSignedIn(<Composer />)
    await userEvent.upload(await screen.findByLabelText('Choose images'), png())
    await screen.findByAltText('Selected image preview')

    await userEvent.click(screen.getByRole('button', { name: 'Remove image' }))

    expect(screen.queryByAltText('Selected image preview')).not.toBeInTheDocument()
    expect(postButton()).toBeDisabled()
  })

  it('allows at most four images and says so', async () => {
    server.use(...uploadHandlers())
    renderSignedIn(<Composer />)

    await userEvent.upload(await screen.findByLabelText('Choose images'), [png('1.png'), png('2.png'), png('3.png'), png('4.png'), png('5.png')])

    await waitFor(() => expect(screen.getAllByAltText('Selected image preview')).toHaveLength(4))
    expect(screen.getByRole('alert')).toHaveTextContent('at most 4 images')
    expect(screen.getByRole('button', { name: 'Add images' })).toBeDisabled()
  })

  it('refuses files that are not images, without contacting the server', async () => {
    const asked = vi.fn()
    server.use(http.post(`${BASE}/api/media/upload-url`, () => (asked(), HttpResponse.json({}))))
    renderSignedIn(<Composer />)

    // applyAccept is off so the file reaches the component's own check (a real picker would filter by type).
    await userEvent.upload(await screen.findByLabelText('Choose images'), new File(['x'], 'notes.pdf', { type: 'application/pdf' }), { applyAccept: false })

    expect(await screen.findByRole('alert')).toHaveTextContent('JPEG, PNG, WebP or GIF')
    expect(asked).not.toHaveBeenCalled()
  })

  it('shows a failed upload and blocks posting until it is removed', async () => {
    server.use(
      http.post(`${BASE}/api/media/upload-url`, () => HttpResponse.json({ status: 503, detail: 'Media storage is not configured' }, { status: 503 })),
    )
    renderSignedIn(<Composer />)
    await userEvent.type(await screen.findByRole('textbox'), 'text is fine')

    await userEvent.upload(screen.getByLabelText('Choose images'), png())

    expect(await screen.findByText('Image uploads are not set up on this server yet.')).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove image' }))
    expect(postButton()).toBeEnabled()
  })
})

describe('Composer: threads', () => {
  it('writes a thread of several posts and sends them in order', async () => {
    let body: { posts?: Array<{ content: string }>; replyPolicy?: string } = {}
    server.use(http.post(`${BASE}/api/posts/thread`, async ({ request }) => ((body = (await request.json()) as typeof body), HttpResponse.json([makePost({ id: 1 }), makePost({ id: 2 })], { status: 201 }))))
    const onPosted = vi.fn()
    renderSignedIn(<Composer onPosted={onPosted} />)

    await userEvent.type(await screen.findByRole('textbox'), 'first')
    await userEvent.click(screen.getByRole('button', { name: 'Add another post' }))
    expect(postButton()).toBeDisabled() // the new, empty post blocks sending
    await userEvent.type(screen.getByRole('textbox', { name: 'Post 2 of 2' }), 'second')
    await userEvent.click(screen.getByRole('button', { name: 'Post all' }))

    await waitFor(() => expect(onPosted).toHaveBeenCalled())
    expect(body).toEqual({ posts: [{ content: 'first' }, { content: 'second' }], replyPolicy: 'EVERYONE' })
    expect(onPosted.mock.calls[0][0]).toHaveLength(2)
  })

  it('removes a post from the thread, back to a single post', async () => {
    renderSignedIn(<Composer />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add another post' }))
    expect(screen.getAllByRole('textbox')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Remove post 2' }))

    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(within(document.body).getByRole('button', { name: 'Post' })).toBeInTheDocument()
  })

  it('stops at 25 posts', async () => {
    renderSignedIn(<Composer />)
    const add = await screen.findByRole('button', { name: 'Add another post' })
    for (let i = 0; i < 24; i++) await userEvent.click(screen.getByRole('button', { name: 'Add another post' }))
    expect(screen.getAllByRole('textbox')).toHaveLength(25)
    expect(add).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add another post' })).not.toBeInTheDocument()
  }, 30_000)
})
