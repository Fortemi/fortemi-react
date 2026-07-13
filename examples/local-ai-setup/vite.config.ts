import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fortemiDbConfig, pgliteWasmPlugin } from '@fortemi/examples-shared/vite-db'

export default defineConfig({
  plugins: [react(), pgliteWasmPlugin()],
  ...fortemiDbConfig,
  build: {
    rollupOptions: {
      output: {
        // Keep the (opt-in, runtime-loaded) transformers.js runtime out of the
        // main bundle — it is only fetched when the user enables embeddings.
        manualChunks(id) {
          if (id.includes('@huggingface/transformers')) return 'ai-transformers'
          if (id.includes('onnxruntime')) return 'ai-onnx'
        },
      },
    },
  },
})
