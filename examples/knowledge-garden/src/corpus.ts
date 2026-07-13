// A small tagged corpus with deliberate tag overlap, seeded once into the
// in-browser database so the garden has structure to search and graph.
export const CORPUS: { title: string; body: string; tags: string[] }[] = [
  { title: 'PGlite in the browser', body: 'Postgres compiled to WASM runs in the tab; no server. The database lives in a worker and persists to OPFS or IndexedDB.', tags: ['architecture', 'pglite', 'schema'] },
  { title: 'Single-writer worker', body: 'All writes serialize through one PGlite worker via postMessage, keeping the database consistent.', tags: ['architecture', 'pglite', 'worker'] },
  { title: 'Tiered persistence', body: 'Chrome uses OPFS, Firefox uses IndexedDB, Safari falls back to in-memory.', tags: ['architecture', 'schema', 'storage'] },
  { title: 'UUIDv7 primary keys', body: 'Time-sortable, monotonic keys that sort by creation and sync cleanly across instances.', tags: ['schema', 'sync'] },
  { title: 'Soft delete only', body: 'deleted_at marks removal; nothing is ever hard-deleted, so history and sync stay intact.', tags: ['schema', 'sync'] },
  { title: 'CommunityGraph shape', body: 'nodes + edges + communities: a framework-agnostic graph the whole stack consumes.', tags: ['graph', 'architecture'] },
  { title: 'Deterministic force layout', body: 'A seeded PRNG drives settlement, so the same graph lays out identically every run.', tags: ['graph', 'layout'] },
  { title: 'Baked render snapshots', body: 'Run layout once at build time and stamp x/y so hosts warm-start with no runtime layout.', tags: ['graph', 'layout', 'build'] },
  { title: 'Three render tiers', body: 'SVG, Sigma 2D, and 3D all consume one control-filter contract.', tags: ['graph', 'ui'] },
  { title: 'Postgres full-text search', body: 'ts_headline snippets and ranked results, all computed in-browser by PGlite.', tags: ['search', 'schema'] },
  { title: 'Prefix suggestions', body: 'Completions drawn from the corpus vocabulary via ts_stat plus recent queries.', tags: ['search', 'ui'] },
  { title: 'Opt-in embeddings', body: 'transformers.js is gated behind a capability, so nothing downloads until you ask.', tags: ['search', 'embeddings', 'capabilities'] },
  { title: 'Knowledge shards', body: 'A tar.gz of notes plus BLAKE3-hashed blob sidecars — a portable, verifiable bundle.', tags: ['shards', 'portability'] },
  { title: 'Shard round-trip', body: 'Export from one browser, import into another: a poor-man’s sync with conflict strategies.', tags: ['shards', 'portability', 'sync'] },
  { title: 'Format parity with the server', body: 'Every JSON field matches the Rust/Postgres server exactly; parity tests gate every release.', tags: ['parity', 'testing'] },
  { title: 'Capability tiers', body: 'GPU, inference, and local-server discovery decide what AI features light up on this device.', tags: ['capabilities', 'ai'] },
]
