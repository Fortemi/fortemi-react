import { defineConfig, devices } from '@playwright/test'

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid E2E_PORT value: ' + value)
  }
  return port
}

function defaultE2ePort(): number {
  if (!process.env.CI) return 5173
  const runId = Number(process.env.GITHUB_RUN_ID ?? process.env.GITHUB_RUN_NUMBER ?? 0)
  return 30000 + (Number.isFinite(runId) ? runId % 20000 : 0)
}

const e2ePort = parsePort(process.env.E2E_PORT) ?? defaultE2ePort()
const baseURL = 'http://127.0.0.1:' + e2ePort

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  // PGlite WASM initialization takes ~25-30s in headless browsers
  timeout: 60000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port ' + e2ePort + ' --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
