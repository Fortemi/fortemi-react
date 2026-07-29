import { defineConfig } from 'vitest/config'
import { cpus } from 'os'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 79,
      },
    },
    // PGlite WASM tests are CPU-heavy — limit parallelism to avoid saturating all cores.
    // Each test file spins up its own PGlite instance (~300MB WASM + PostgreSQL process).
    // Override with VITEST_MAX_WORKERS env var.
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || Math.min(Math.max(Math.floor(cpus().length / 2), 2), 4),
    minWorkers: 1,
    hookTimeout: 30_000,
    teardownTimeout: 60_000,
  },
})
