import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// See EX-01/02 — the render path pulls @fortemi/graph (GraphController → core).
// This demo only maps/loads render data, so stub @fortemi/core to keep PGlite out.
function stubFortemiCore(): Plugin {
  const stubId = '\0fortemi-core-stub'
  return {
    name: 'stub-fortemi-core',
    enforce: 'pre',
    resolveId(source) {
      return source === '@fortemi/core' ? stubId : null
    },
    load(id) {
      if (id !== stubId) return null
      return 'export class GraphRepository {}\nexport class CommunitiesRepository {}\n'
    },
  }
}

export default defineConfig({ plugins: [react(), stubFortemiCore()] })
