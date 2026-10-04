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

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})
