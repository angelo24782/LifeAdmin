import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const isCI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    // In locale si usa il Chrome installato (nessun download di browser); in CI Chromium di Playwright.
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: isCI ? undefined : 'chrome' },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: isCI ? undefined : 'chrome' },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
