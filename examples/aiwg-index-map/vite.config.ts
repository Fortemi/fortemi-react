import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fortemiDbConfig, pgliteWasmPlugin } from '@fortemi/examples-shared/vite-db'

export default defineConfig({
  plugins: [react(), pgliteWasmPlugin()],
  ...fortemiDbConfig,
})
