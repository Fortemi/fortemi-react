// Tiny deterministic PRNG (mulberry32). Used by the force layout to seed
// initial jitter so that identical (seed, graph, options) always yields
// identical coordinates — no Math.random, no time, no platform variance.

/**
 * Create a deterministic pseudo-random generator from a 32-bit integer seed.
 * Returns a function producing floats in [0, 1). Identical seeds yield
 * identical sequences across platforms.
 */
export function mulberry32(seed: number): () => number {
  // Coerce to a non-zero unsigned 32-bit integer so seed 0 still advances.
  let a = (seed >>> 0) || 0x9e3779b9
  return function next(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
