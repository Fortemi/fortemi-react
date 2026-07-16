// Playwright config for the built examples gallery (examples/_site/).
//
// Unlike apps/standalone (which tests against the Vite dev server), this suite
// exercises the exact static tree `pnpm examples:site:build` produces and
// deploys — bundled shards, COOP/COEP serving, and all. Build the site first:
//
//   pnpm examples:site:build
//   pnpm examples:site:e2e
import { defineConfig, devices } from '@playwright/test'

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid EXAMPLES_E2E_PORT value: ' + value)
  }
  return port
}

const port = parsePort(process.env.EXAMPLES_E2E_PORT) ?? 4321
const baseURL = 'http://127.0.0.1:' + port

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'html',
  // The semantic upgrade path imports a 3.4 MB shard into PGlite WASM and
  // downloads the ~23 MB MiniLM query model — budget generously.
  timeout: 420_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node examples/scripts/serve-site.mjs',
    cwd: '..',
    env: { PORT: String(port) },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
