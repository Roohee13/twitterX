import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// Many test files run in parallel on a busy machine; waiting for something to appear should not be a coin toss at 1 s.
configure({ asyncUtilTimeout: 4000 })

// jsdom has no object URLs (used for image previews).
// jsdom does not implement the modal <dialog> methods.
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.removeAttribute('open')
  this.dispatchEvent(new Event('close'))
}

// The app opens a live connection when signed in; unit tests have no server for it, so it just never connects.
class IdleWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly readyState = 0
  binaryType = 'blob'
  close() {}
  send() {}
}

// jsdom does not scroll.
Element.prototype.scrollIntoView ??= function scrollIntoView() {}

beforeEach(() => {
  vi.stubGlobal('WebSocket', IdleWebSocket)
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})
