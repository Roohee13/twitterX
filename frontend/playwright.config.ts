import { defineConfig, devices } from '@playwright/test'

// Browser tests run against the real backend (scripts/e2e-backend.sh, port 8090) through their own Vite dev server (port 5174),
// so they never collide with a backend/dev server you run yourself on 8080/5173.
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    env: { VITE_PORT: '5174', VITE_BACKEND_URL: 'http://localhost:8090' },
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
