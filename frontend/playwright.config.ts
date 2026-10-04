import { defineConfig, devices } from '@playwright/test'

// Browser tests run against the real backend (scripts/e2e-backend.sh, port 8090) and the production build of the app, served on port 5174,
// so they never collide with a backend/dev server you run yourself on 8080/5173. The built app talks to the API on its own origin
// (VITE_API_BASE), exactly as a deployed one does, so CORS and the WebSocket address are exercised too. The preview server's proxy is only
// for the tests' own setup calls (`request.post('/api/...')`); it must point at the e2e backend, never at your dev backend on 8080.
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/results',
  fullyParallel: false,
  workers: 1,
  // A slow machine (or a shared CI runner) can take a while to settle a screen: leave room, and retry once there so one stall is not a red build.
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  // The full run takes several minutes on a busy laptop, so a screen can take longer to settle than the 5 s default.
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    // 127.0.0.1, not localhost: Playwright's API client waits ~4 s per request on "localhost" here (the dev server listens on IPv4 only).
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 5174 --strictPort --host 127.0.0.1',
    env: { VITE_BACKEND_URL: 'http://127.0.0.1:8090', VITE_API_BASE: 'http://127.0.0.1:8090' },
    url: 'http://127.0.0.1:5174',
    // Never reuse a server: a leftover one could be serving an old build, or proxying to the wrong backend.
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
