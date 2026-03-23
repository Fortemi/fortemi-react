import { defineConfig } from 'vitest/config'
import { cpus } from 'os'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    // PGlite WASM tests are CPU-heavy — limit parallelism to avoid saturating all cores.
    // Each test file spins up its own PGlite instance (~300MB WASM + PostgreSQL process).
    // Override with VITEST_MAX_WORKERS env var.
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || Math.max(Math.floor(cpus().length / 2), 2),
    minWorkers: 1,
  },
})
