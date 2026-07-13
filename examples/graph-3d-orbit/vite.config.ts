import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Keep the PGlite WASM data layer out of a graph-only build. The graph views
 * pull `@fortemi/graph`, which re-exports `GraphController` (a `@fortemi/core` /
 * PGlite consumer for live DB-backed graphs). These demos render synthetic
 * `CommunityGraph` data, so we stub `@fortemi/core` and the ~9 MB PGlite engine
 * never enters the bundle. Remove this plugin when your app reads the database.
 */
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

export default defineConfig({
  plugins: [react(), stubFortemiCore()],
})
