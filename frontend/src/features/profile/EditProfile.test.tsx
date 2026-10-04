import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import { makeProfile } from '../../test/fixtures'
import { BASE, me, renderSignedIn, server } from '../../test/render'
import { ProfilePage } from './ProfilePage'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
})
afterEach(() => server.resetHandlers())

const png = (name = 'me.png') => new File([new Uint8Array(32)], name, { type: 'image/png' })

/** My own profile, which the fake server updates when it receives the PATCH. */
function serve(overrides = {}) {
  const state = { profile: makeProfile({ id: 1, username: 'alice', displayName: 'Alice', bio: 'old bio', avatarUrl: 'https://media.test/old-avatar.png', bannerUrl: 'https://media.test/old-banner.png', ...overrides }), patch: undefined as Record<string, unknown> | undefined }
  server.use(
    http.get(`${BASE}/api/users/alice`, () => HttpResponse.json(state.profile)),
    http.get(`${BASE}/api/users/alice/:tab`, () => HttpResponse.json({ items: [], nextCursor: null })),
    http.patch(`${BASE}/api/users/me`, async ({ request }) => {
      state.patch = (await request.json()) as Record<string, unknown>
      const next = { ...state.profile, ...(state.patch.displayName ? { displayName: state.patch.displayName as string } : {}), ...('bio' in state.patch ? { bio: (state.patch.bio as string) || null } : {}) }
      state.profile = next
      return HttpResponse.json({ ...me, displayName: next.displayName, bio: next.bio })
    }),
  )
  return state
}

/** Presigned upload that succeeds; `gate` can hold the storage PUT open to see the "uploading" state. */
function uploads(gate?: Promise<void>) {
  server.use(
    http.post(`${BASE}/api/media/upload-url`, () =>
      HttpResponse.json({ key: 'users/1/new-image.png', uploadUrl: 'https://r2.test/up', headers: { 'content-type': ['image/png'] }, publicUrl: 'https://media.test/new-image.png', expiresAt: 'x' }),
    ),
    http.put('https://r2.test/up', async () => (await gate, new HttpResponse(null, { status: 200 }))),
  )
}

async function openEditor() {
  renderSignedIn(<Routes><Route path="/u/:username" element={<ProfilePage />} /></Routes>, { route: '/u/alice' })
  await userEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
  return screen.findByRole('dialog', { name: 'Edit profile' })
}

describe('Edit profile', () => {
  it('starts with your current details and nothing to save', async () => {
    serve()
    const dialog = await openEditor()

    expect(within(dialog).getByLabelText('Name')).toHaveValue('Alice')
    expect(within(dialog).getByLabelText('Bio')).toHaveValue('old bio')
    expect(within(dialog).getByAltText('Banner preview')).toHaveAttribute('src', 'https://media.test/old-banner.png')
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves only what changed, and the page shows the new name', async () => {
    const state = serve()
    const dialog = await openEditor()

    await userEvent.clear(within(dialog).getByLabelText('Name'))
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Alice A.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(state.patch).toEqual({ displayName: 'Alice A.' }))
    expect(await screen.findByText('Your profile was updated.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Alice A.', level: 2 })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit profile' })).not.toBeInTheDocument())
  })

  it('clears the bio when it is emptied', async () => {
    const state = serve()
    const dialog = await openEditor()

    await userEvent.clear(within(dialog).getByLabelText('Bio'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(state.patch).toEqual({ bio: '' }))
  })

  it('will not save an empty name or a bio over 160 characters', async () => {
    serve()
    const dialog = await openEditor()

    await userEvent.clear(within(dialog).getByLabelText('Name'))
    expect(within(dialog).getByText('Enter a name')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Alice')

    await userEvent.click(within(dialog).getByLabelText('Bio'))
    await userEvent.paste('x'.repeat(161))
    expect(within(dialog).getByLabelText(/characters over the limit/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('uploads a new profile photo and sends its key with the save', async () => {
    const state = serve()
    uploads()
    const dialog = await openEditor()

    await userEvent.upload(within(dialog).getByLabelText('Choose profile photo'), png())

    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled())
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.patch).toEqual({ avatarKey: 'users/1/new-image.png' }))
  })

  it('cannot be saved while a picture is still uploading', async () => {
    serve()
    let release: () => void = () => undefined
    uploads(new Promise<void>((resolve) => { release = resolve }))
    const dialog = await openEditor()
    await userEvent.type(within(dialog).getByLabelText('Name'), '!')

    await userEvent.upload(within(dialog).getByLabelText('Choose banner'), png('banner.png'))

    expect(await within(dialog).findByRole('progressbar', { name: 'Uploading banner' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    release()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled())
  })

  it('removes the banner by sending an empty key', async () => {
    const state = serve()
    const dialog = await openEditor()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove banner' }))
    expect(within(dialog).queryByAltText('Banner preview')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(state.patch).toEqual({ bannerKey: '' }))
  })

  it('says why a picture failed and does not send it', async () => {
    const state = serve()
    server.use(http.post(`${BASE}/api/media/upload-url`, () => HttpResponse.json({ status: 503, detail: 'Media storage is not configured' }, { status: 503 })))
    const dialog = await openEditor()

    await userEvent.upload(within(dialog).getByLabelText('Choose profile photo'), png())

    expect(await within(dialog).findByText('Image uploads are not set up on this server yet.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled() // nothing valid to save
    expect(state.patch).toBeUndefined()
  })

  it('refuses a file that is not an image without contacting the server', async () => {
    serve()
    const asked = vi.fn()
    server.use(http.post(`${BASE}/api/media/upload-url`, () => (asked(), HttpResponse.json({}))))
    const dialog = await openEditor()

    await userEvent.upload(within(dialog).getByLabelText('Choose banner'), new File(['x'], 'notes.pdf', { type: 'application/pdf' }), { applyAccept: false })

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('JPEG, PNG, WebP or GIF')
    expect(asked).not.toHaveBeenCalled()
  })

  it('shows the server message when saving fails and stays open', async () => {
    serve()
    server.use(http.patch(`${BASE}/api/users/me`, () => HttpResponse.json({ status: 400, detail: 'Validation failed', errors: { displayName: 'size must be between 1 and 50' } }, { status: 400 })))
    const dialog = await openEditor()

    await userEvent.type(within(dialog).getByLabelText('Name'), 'x')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(await within(dialog).findByText('size must be between 1 and 50')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit profile' })).toBeInTheDocument()
  })
})
