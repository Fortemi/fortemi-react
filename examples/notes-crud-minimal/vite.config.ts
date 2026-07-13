import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fortemiDbConfig, pgliteWasmPlugin } from '@fortemi/examples-shared/vite-db'

// DB example: mounts FortemiProvider, so it needs the PGlite/worker wiring.
// See @fortemi/examples-shared/vite-db for what each option does (and how to
// inline it when you copy this example out).
export default defineConfig({
  plugins: [react(), pgliteWasmPlugin()],
  ...fortemiDbConfig,
})
