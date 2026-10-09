import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureApi } from './api'
import { tokens } from './tokens'
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, isVideoUrl, uploadImage, validateImage, validateVideo } from './upload'

const BASE = 'http://api.test'
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  configureApi({ baseUrl: BASE })
  tokens.set('access', 'refresh')
})
afterEach(() => server.resetHandlers())

const image = (type = 'image/png', size = 100, name = 'cat.png') => new File([new Uint8Array(size)], name, { type })

describe('validateVideo', () => {
  const video = (type = 'video/mp4', size = 100, name = 'clip.mp4') => ({ type, size, name })

  it('accepts MP4 and WebM within the limit', () => {
    expect(validateVideo(video())).toBeNull()
    expect(validateVideo(video('video/webm', MAX_VIDEO_BYTES, 'clip.webm'))).toBeNull()
  })

  it('explains what is wrong', () => {
    expect(validateVideo(video('video/quicktime', 10, 'clip.mov'))).toMatch(/MP4 or WebM/)
    expect(validateVideo(video('video/mp4', MAX_VIDEO_BYTES + 1))).toMatch(/at most 50 MB/)
    expect(validateVideo(video('video/mp4', 0))).toMatch(/empty/)
  })

  it('tells videos from images by the address the server built', () => {
    expect(isVideoUrl('https://media.test/users/1/abc.mp4')).toBe(true)
    expect(isVideoUrl('https://media.test/users/1/abc.WEBM')).toBe(true)
    expect(isVideoUrl('https://media.test/users/1/abc.png')).toBe(false)
  })
})

describe('validateImage', () => {
  it('accepts the four supported types', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) expect(validateImage(image(type))).toBeNull()
  })

  it('explains what is wrong', () => {
    expect(validateImage(image('application/pdf', 10, 'doc.pdf'))).toMatch(/JPEG, PNG, WebP or GIF/)
    expect(validateImage({ type: 'image/png', size: MAX_IMAGE_BYTES + 1, name: 'big.png' })).toMatch(/at most 5 MB/)
    expect(validateImage({ type: 'image/png', size: 0, name: 'empty.png' })).toMatch(/empty/)
  })
})

describe('uploadImage', () => {
  it('asks for a presigned URL, then sends the bytes to it with the returned headers', async () => {
    let asked: unknown
    let putHeaders: Headers | undefined
    let putBytes = 0
    server.use(
      http.post(`${BASE}/api/media/upload-url`, async ({ request }) => {
        asked = await request.json()
        return HttpResponse.json({
          key: 'users/1/abc.png',
          uploadUrl: 'https://r2.test/bucket/users/1/abc.png?sig=1',
          headers: { 'content-type': ['image/png'], host: ['r2.test'] },
          publicUrl: 'https://media.test/users/1/abc.png',
          expiresAt: '2030-01-01T00:00:00Z',
        })
      }),
      http.put('https://r2.test/bucket/users/1/abc.png', async ({ request }) => {
        putHeaders = request.headers
        putBytes = (await request.arrayBuffer()).byteLength
        return new HttpResponse(null, { status: 200 })
      }),
    )
    const progress = vi.fn()

    const result = await uploadImage(image('image/png', 321), progress)

    expect(asked).toEqual({ contentType: 'image/png', contentLength: 321 })
    expect(putHeaders?.get('content-type')).toBe('image/png')
    expect(putBytes).toBe(321)
    expect(result).toEqual({ key: 'users/1/abc.png', publicUrl: 'https://media.test/users/1/abc.png' })
    expect(progress).toHaveBeenLastCalledWith(1)
  })

  it('reports a server without image storage in plain words', async () => {
    server.use(http.post(`${BASE}/api/media/upload-url`, () => HttpResponse.json({ status: 503, detail: 'Media storage is not configured' }, { status: 503 })))
    await expect(uploadImage(image(), vi.fn())).rejects.toMatchObject({ status: 503, message: 'Image uploads are not set up on this server yet.' })
  })

  it('fails when storage rejects the upload', async () => {
    server.use(
      http.post(`${BASE}/api/media/upload-url`, () =>
        HttpResponse.json({ key: 'k', uploadUrl: 'https://r2.test/x', headers: {}, publicUrl: 'p', expiresAt: 'e' }),
      ),
      http.put('https://r2.test/x', () => new HttpResponse(null, { status: 403 })),
    )
    await expect(uploadImage(image(), vi.fn())).rejects.toMatchObject({ status: 403 })
  })
})
