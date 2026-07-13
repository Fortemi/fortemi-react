import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// No-DB graph example: @fortemi/graph re-exports GraphController, which imports
// the @fortemi/core (PGlite) database layer. We never build a controller here,
// so stub @fortemi/core to keep the ~9 MB engine out of the bundle.
function stubFortemiCore(): Plugin {
  const stubId = '\0fortemi-core-stub'
  return {
    name: 'stub-fortemi-core',
    enforce: 'pre',
    resolveId: (source) => (source === '@fortemi/core' ? stubId : null),
    load: (id) =>
      id === stubId
        ? 'export class GraphRepository {}\nexport class CommunitiesRepository {}\n'
        : null,
  }
}

export default defineConfig({ plugins: [react(), stubFortemiCore()] })
