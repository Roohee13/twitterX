import { defineConfig, devices } from '@playwright/test'

// Browser tests run against the real backend (scripts/e2e-backend.sh, port 8090) through their own Vite dev server (port 5174),
// so they never collide with a backend/dev server you run yourself on 8080/5173.
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The full run takes several minutes on a busy laptop, so a screen can take longer to settle than the 5 s default.
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    // 127.0.0.1, not localhost: Playwright's API client waits ~4 s per request on "localhost" here (the dev server listens on IPv4 only).
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    env: { VITE_PORT: '5174', VITE_BACKEND_URL: 'http://localhost:8090' },
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
