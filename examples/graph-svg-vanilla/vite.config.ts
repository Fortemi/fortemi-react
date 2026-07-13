import { defineConfig, type Plugin } from 'vite'

/**
 * Keep the PGlite WASM data layer out of a graph-only build.
 *
 * `@fortemi/graph` re-exports `GraphController`, which imports `@fortemi/core`
 * (Postgres-in-WASM) to load graphs *live* from a database. This demo renders a
 * static, hand-authored `CommunityGraph` and never constructs a controller, so
 * we stub `@fortemi/core` to an empty module — the ~9 MB PGlite engine never
 * enters the bundle and the page loads instantly.
 *
 * Delete this plugin the moment your app actually reads from the database.
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
  plugins: [stubFortemiCore()],
})
