import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A device whose light/dark setting the test controls. */
function deviceTheme(initial: 'light' | 'dark') {
  let light = initial === 'light'
  const listeners = new Set<() => void>()
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('light') ? light : !light,
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia
  return {
    switchTo(next: 'light' | 'dark') {
      light = next === 'light'
      act(() => listeners.forEach((listener) => listener()))
    },
  }
}

/** The page loading again: module state is gone, the browser's storage and the <html> element are what they were. */
const freshTheme = async () => {
  vi.resetModules()
  return import('./theme')
}
const attr = () => document.documentElement.getAttribute('data-theme')

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.head.innerHTML = '<meta name="theme-color" content="#000000">'
})
afterEach(() => {
  // @ts-expect-error put the jsdom default back
  delete window.matchMedia
})

describe('which theme shows', () => {
  it('follows the device when nothing was chosen', async () => {
    deviceTheme('light')
    await freshTheme()
    expect(attr()).toBe('light')

    deviceTheme('dark')
    await freshTheme()
    expect(attr()).toBe('dark')
  })

  it('an explicit choice beats the device', async () => {
    deviceTheme('dark')
    localStorage.setItem('xclone.theme', 'light')
    await freshTheme()
    expect(attr()).toBe('light')

    deviceTheme('light')
    localStorage.setItem('xclone.theme', 'dark')
    await freshTheme()
    expect(attr()).toBe('dark')
  })

  it('ignores anything odd in storage', async () => {
    deviceTheme('light')
    localStorage.setItem('xclone.theme', 'purple')
    const theme = await freshTheme()
    expect(theme.readPreference()).toBe('system')
    expect(attr()).toBe('light')
  })

  it('is dark when the device cannot say', async () => {
    await freshTheme() // jsdom has no matchMedia
    expect(attr()).toBe('dark')
  })
})

describe('changing it', () => {
  it('applies at once, is remembered, and "device" forgets the choice', async () => {
    deviceTheme('dark')
    const theme = await freshTheme()

    theme.setThemePreference('light')
    expect(attr()).toBe('light')
    expect(localStorage.getItem('xclone.theme')).toBe('light')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#ffffff') // the phone's address bar too

    theme.setThemePreference('system')
    expect(attr()).toBe('dark') // the device is dark
    expect(localStorage.getItem('xclone.theme')).toBeNull()
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#000000')
  })

  it('"device" follows the device while the page is open; an explicit choice does not', async () => {
    const device = deviceTheme('dark')
    const theme = await freshTheme()
    expect(attr()).toBe('dark')

    device.switchTo('light')
    expect(attr()).toBe('light')

    theme.setThemePreference('dark')
    device.switchTo('light')
    expect(attr()).toBe('dark')
  })

  it('a change made in another tab shows here too', async () => {
    deviceTheme('dark')
    await freshTheme()
    localStorage.setItem('xclone.theme', 'light')

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'xclone.theme', newValue: 'light' }))
    })

    expect(attr()).toBe('light')
  })

  it('still works when storage is blocked: it lasts until the page closes', async () => {
    deviceTheme('dark')
    const theme = await freshTheme()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(() => theme.setThemePreference('light')).not.toThrow()
    expect(attr()).toBe('light')
    vi.restoreAllMocks()
  })
})

describe('the controls', () => {
  async function renderToggle() {
    const { ThemeToggle } = await import('../components/ui/ThemeToggle')
    return render(<ThemeToggle />)
  }

  it('the toggle says what it will do, does it, and then says the opposite', async () => {
    deviceTheme('dark')
    await freshTheme()
    await renderToggle()

    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))

    expect(attr()).toBe('light')
    expect(localStorage.getItem('xclone.theme')).toBe('light')
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))
    expect(attr()).toBe('dark')
  })

  it('the toggle follows the device when it changes', async () => {
    const device = deviceTheme('dark')
    await freshTheme()
    await renderToggle()
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument()

    device.switchTo('light')

    expect(await screen.findByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument()
  })

  it('the appearance settings offer device, light and dark, with the current one selected', async () => {
    deviceTheme('dark')
    await freshTheme()
    const { AppearanceSection } = await import('../features/settings/AppearanceSection')
    render(<AppearanceSection />)
    const group = screen.getByRole('group', { name: 'Appearance' })
    expect(screen.getByRole('radio', { name: /^Device/ })).toBeChecked()

    await userEvent.click(screen.getByRole('radio', { name: /^Light/ }))

    expect(screen.getByRole('radio', { name: /^Light/ })).toBeChecked()
    expect(attr()).toBe('light')
    expect(group).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /^Device/ }))
    expect(localStorage.getItem('xclone.theme')).toBeNull()
    expect(attr()).toBe('dark')
  })
})
