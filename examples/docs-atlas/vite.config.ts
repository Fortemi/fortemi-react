import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The runtime imports @fortemi/graph (loadRenderSnapshot), whose root re-exports
// GraphController → @fortemi/core → PGlite. This atlas only *loads* baked render
// data, so stub @fortemi/core to keep the ~9 MB engine out of the static build.
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
