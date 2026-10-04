import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, configureApi } from '../../lib/api'
import { tokens } from '../../lib/tokens'
import type { StorageStep } from '../../lib/types'
import { BASE, renderSignedIn, server } from '../../test/render'
import { SettingsPage } from './SettingsPage'

// The browser's own upload (XMLHttpRequest to storage) is replaced: what matters here is what the tool does with its outcome.
const upload = vi.hoisted(() => ({ uploadImage: vi.fn() }))
vi.mock('../../lib/upload', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/upload')>()), uploadImage: upload.uploadImage }))

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.clear()
  upload.uploadImage.mockReset()
  server.use(
    http.get(`${BASE}/api/users/me/blocks`, () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get(`${BASE}/api/users/me/mutes`, () => HttpResponse.json({ items: [], nextCursor: null })),
  )
})
afterEach(() => server.resetHandlers())

const step = (id: string, label: string, ok = true, extra: Partial<StorageStep> = {}): StorageStep => ({ id, label, ok, detail: `${label} detail`, hint: null, ...extra })
const serverSteps = [step('config', 'Storage settings'), step('presign', 'Upload address'), step('upload', 'Upload a test image'), step('stored', 'Find it in the bucket'), step('public', 'Public address'), step('cleanup', 'Remove the test image')]

/** Fake backend for the check: records each call's body and answers with the given steps. */
function serve(first: { ok: boolean; steps: StorageStep[] }, second?: { ok: boolean; steps: StorageStep[] }) {
  const bodies: unknown[] = []
  server.use(http.post(`${BASE}/api/admin/storage/check`, async ({ request }) => {
    bodies.push(await request.json())
    return HttpResponse.json(bodies.length === 1 ? first : (second ?? first))
  }))
  return bodies
}
const openAs = (admin: boolean) => renderSignedIn(<SettingsPage />, { route: '/settings', user: { admin } })
const press = async () => {
  const section = await screen.findByRole('region', { name: 'Image storage' })
  await userEvent.click(within(section).getByRole('button', { name: 'Check image storage' }))
  return section
}

describe('image storage check (admins)', () => {
  it('is not offered to anyone else', async () => {
    openAs(false)
    await screen.findByRole('form', { name: 'Username' })
    expect(screen.queryByRole('region', { name: 'Image storage' })).not.toBeInTheDocument()
  })

  it('runs the server check, then uploads a tiny PNG from the browser, then has the server confirm it: all green', async () => {
    const bodies = serve({ ok: true, steps: serverSteps }, { ok: true, steps: [step('config', 'Storage settings'), step('browser-upload', 'Image uploaded from your browser'), step('browser-public', 'Public address (from the browser\'s upload)'), step('browser-cleanup', 'Remove the test image')] })
    upload.uploadImage.mockResolvedValue({ key: 'users/1/abc.png', publicUrl: 'https://pub.example/users/1/abc.png' })
    openAs(true)

    const section = await press()

    expect(await within(section).findByText('Image storage is working: photos can be uploaded and shown.')).toBeInTheDocument()
    const file = upload.uploadImage.mock.calls[0][0] as File
    expect(file.type).toBe('image/png')
    expect(file.size).toBeGreaterThan(0)
    expect(file.size).toBeLessThan(1024)
    expect(bodies).toEqual([{}, { browserTestKey: 'users/1/abc.png' }])
    const results = within(section).getByRole('list', { name: 'Check results' })
    expect(within(results).getAllByRole('listitem')).toHaveLength(9) // 6 server steps + 3 browser steps, the settings step not repeated
    expect(within(results).getByText('Image uploaded from your browser')).toBeInTheDocument()
  })

  it('shows the failed server step with its fix, and does not try the browser at all', async () => {
    serve({ ok: false, steps: [step('config', 'Storage settings'), step('presign', 'Upload address'), step('upload', 'Upload a test image', false, { detail: 'HTTP 403 AccessDenied: Access Denied', hint: "The API token is not allowed to write to this bucket. Create a token with 'Object Read & Write'." })] })
    openAs(true)

    const section = await press()

    expect(await within(section).findByText(/Create a token with 'Object Read & Write'/)).toBeInTheDocument()
    expect(within(section).getByText('HTTP 403 AccessDenied: Access Denied')).toBeInTheDocument()
    expect(within(section).getAllByLabelText('Failed')).toHaveLength(1)
    expect(within(section).queryByText(/Image storage is working/)).not.toBeInTheDocument()
    expect(upload.uploadImage).not.toHaveBeenCalled()
  })

  it('when only the browser cannot upload, it points at the CORS rule with this site\'s own address and the rule to paste', async () => {
    const bodies = serve({ ok: true, steps: serverSteps })
    upload.uploadImage.mockRejectedValue(new ApiError(0, 'The image could not be uploaded. Check your connection and try again.'))
    openAs(true)

    const section = await press()

    expect(await within(section).findByText(/almost always the bucket's CORS rule: it must allow/)).toBeInTheDocument()
    const rule = within(section).getByLabelText('CORS rule to use')
    expect(JSON.parse(rule.textContent ?? '')).toEqual([{ AllowedOrigins: [window.location.origin], AllowedMethods: ['PUT'], AllowedHeaders: ['content-type', 'content-length'], MaxAgeSeconds: 3600 }])
    expect(bodies).toHaveLength(1) // the server is not asked to confirm an upload that never happened
    expect(within(section).queryByText(/Image storage is working/)).not.toBeInTheDocument()
  })

  it('an upload the storage server answered with an error is reported as that, not as CORS', async () => {
    serve({ ok: true, steps: serverSteps })
    upload.uploadImage.mockRejectedValue(new ApiError(403, 'The image could not be uploaded. Please try again.'))
    openAs(true)

    const section = await press()

    expect(await within(section).findByText('The storage server refused the upload from the browser.')).toBeInTheDocument()
    expect(within(section).queryByLabelText('CORS rule to use')).not.toBeInTheDocument()
  })

  it('a problem found only in the second part (the public address of the browser\'s image) is shown', async () => {
    serve({ ok: true, steps: serverSteps }, { ok: false, steps: [step('config', 'Storage settings'), step('browser-upload', 'Image uploaded from your browser'), step('browser-public', 'Public address', false, { detail: 'HTTP 403', hint: 'Check that public access is enabled.' })] })
    upload.uploadImage.mockResolvedValue({ key: 'users/1/abc.png', publicUrl: 'x' })
    openAs(true)

    const section = await press()

    expect(await within(section).findByText('Check that public access is enabled.')).toBeInTheDocument()
    expect(within(section).queryByText(/Image storage is working/)).not.toBeInTheDocument()
  })

  it('shows a message when the check itself cannot be run, and a new run clears the old result', async () => {
    server.use(http.post(`${BASE}/api/admin/storage/check`, () => HttpResponse.json({ status: 500, detail: 'Something broke' }, { status: 500 })))
    openAs(true)
    const section = await press()
    expect(await within(section).findByText('Something broke')).toBeInTheDocument()

    server.use(http.post(`${BASE}/api/admin/storage/check`, () => HttpResponse.json({ ok: false, steps: [step('config', 'Storage settings', false, { detail: 'Not set: R2_ACCOUNT_ID', hint: 'Set them.' })] })))
    await userEvent.click(within(section).getByRole('button', { name: 'Check image storage' }))

    expect(await within(section).findByText('Not set: R2_ACCOUNT_ID')).toBeInTheDocument()
    await waitFor(() => expect(within(section).queryByText('Something broke')).not.toBeInTheDocument())
  })
})
