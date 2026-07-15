// src/components/fortemi/dedupeDocuments.ts
//
// Corpus documents are chunked into multiple notes titled
// "<Document Title> (part X/N)" (e.g. "REF-001: … (part 3/24)"). Search runs
// at the chunk level, so a single document can occupy several result rows.
// Readers should only ever see one row per document — the chunking is an
// indexing detail, not something the user should have to reason about.
//
// dedupeDocuments() collapses chunk hits to their parent document: it keeps the
// highest-ranked chunk per document (input is assumed already ordered best-first
// by the search) and exposes the clean document title via `displayTitle`.
//
// Because one document can contribute many chunks, callers should over-fetch
// (search with a generous limit) and then dedupe down to the display count, so
// a chunk-heavy document can't crowd distinct documents out of the results.

const PART_SUFFIX = /\s*\(part\s+\d+\s*\/\s*\d+\)\s*$/i;

/** Strip the "(part X/N)" chunk suffix to recover the parent-document title. */
export function documentTitle(title: string | null | undefined): string {
  return (title ?? '').replace(PART_SUFFIX, '').trim() || '(untitled)';
}

/**
 * Collapse chunk-level search hits to one row per parent document.
 * Preserves input order (best-first), keeps the first (best) chunk seen per
 * document, and caps the output at `max` documents.
 */
export function dedupeDocuments<T extends { id: string; title: string | null }>(
  results: readonly T[],
  max: number,
): Array<T & { displayTitle: string }> {
  const seen = new Set<string>();
  const out: Array<T & { displayTitle: string }> = [];
  for (const r of results) {
    const key = documentTitle(r.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, displayTitle: key });
    if (out.length >= max) break;
  }
  return out;
}
