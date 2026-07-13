import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fortemiDbConfig, pgliteWasmPlugin } from '@fortemi/examples-shared/vite-db'

// This example mounts FortemiProvider to *produce* a shard (the export half
// needs the database). The *reader* half — useShard — uses no PGlite at all.
export default defineConfig({
  plugins: [react(), pgliteWasmPlugin()],
  ...fortemiDbConfig,
})
