import { useSyncExternalStore } from 'react'

/** What the person chose. `system` follows the operating system's light / dark setting and changes with it. */
export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'xclone.theme'
const LIGHT_QUERY = '(prefers-color-scheme: light)'
const COLORS: Record<Theme, string> = { dark: '#000000', light: '#ffffff' } // the browser's address bar on phones

export function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia(LIGHT_QUERY).matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  return preference === 'system' ? systemTheme() : preference
}

/** Puts the theme on the page: the attribute the stylesheet keys on, and the phone's address-bar colour. */
export function applyTheme(preference: ThemePreference) {
  const theme = resolveTheme(preference)
  document.documentElement.setAttribute('data-theme', theme)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme])
}

let preference: ThemePreference = readPreference()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export function setThemePreference(next: ThemePreference) {
  preference = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    /* storage blocked: the choice lasts until the page is closed */
  }
  applyTheme(next)
  notify()
}

// "System" has to follow the OS while the page is open (sunset, a manual switch in the OS settings).
try {
  window.matchMedia(LIGHT_QUERY).addEventListener('change', () => {
    if (preference === 'system') {
      applyTheme('system')
      notify()
    }
  })
} catch {
  /* no matchMedia (very old browser, some test environments) */
}

// Another tab changed it.
window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return
  preference = readPreference()
  applyTheme(preference)
  notify()
})

applyTheme(preference)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The saved choice, and a way to change it. */
export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  return [useSyncExternalStore(subscribe, () => preference), setThemePreference]
}

/** The theme actually showing right now (never `system`). It changes when the device's setting does, even if the saved choice stays "device". */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => resolveTheme(preference))
}

/** For tests: forget the in-memory choice and read it again from storage. */
export function resetThemeForTests() {
  preference = readPreference()
  applyTheme(preference)
  notify()
}
