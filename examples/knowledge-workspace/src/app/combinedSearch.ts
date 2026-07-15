// src/components/fortemi/combinedSearch.ts
//
// The Fortémi text backend matches with plainto_tsquery, which ANDs every
// term: a note must contain ALL query words to match. For a research corpus
// that means multi-word queries frequently return nothing — e.g. "multi-agent
// SDLC" needs one note containing "multi" AND "agent" AND "sdlc", and "sdlc"
// may not be a lexeme anywhere. The user types phrases and gets an empty list.
//
// combinedDocumentSearch() handles the term combination better:
//   1. Precision pass — run the full query (backend AND) so notes that contain
//      every term rank first and get a snippet highlighting all terms.
//   2. Recall pass — run each term separately and OR-combine the results, so a
//      document matching SOME terms still surfaces, ranked by how many distinct
//      query terms it covers.
// Results are then collapsed to one row per parent document (see
// dedupeDocuments) and capped at the display count.

import { documentTitle } from './dedupeDocuments';

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/** Distinct, lowercased query terms (≥2 chars), capped to bound search calls. */
export function queryTerms(query: string, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of query.toLowerCase().split(WORD_SPLIT)) {
    const t = raw.trim();
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

type Runner<T> = (query: string, options?: { limit?: number }) => Promise<{ results: T[] }>;

/**
 * AND-first, OR-fallback document search. `run` is any search function that
 * returns `{ results }` (e.g. the useSearch hook's `search` or a
 * SearchRepository's `search`). Returns at most `displayCount` distinct
 * documents, each carrying the best-matching chunk plus a clean `displayTitle`.
 */
export async function combinedDocumentSearch<
  T extends { id: string; title: string | null; rank?: number },
>(
  run: Runner<T>,
  query: string,
  displayCount: number,
  fetchLimit = 60,
): Promise<Array<T & { displayTitle: string }>> {
  const q = query.trim();
  if (!q) return [];

  type Acc = { best: T; bestRank: number; coverage: Set<string>; exact: boolean; key: string };
  const docs = new Map<string, Acc>();

  const absorb = (hits: T[], opts: { exact?: boolean; term?: string }) => {
    for (const h of hits) {
      const key = documentTitle(h.title);
      let a = docs.get(key);
      if (!a) {
        a = { best: h, bestRank: h.rank ?? 0, coverage: new Set(), exact: false, key };
        docs.set(key, a);
      }
      // Prefer an exact-match chunk as the representative (its snippet shows all
      // terms); otherwise prefer the higher-ranked chunk.
      const preferForSnippet = Boolean(opts.exact) && !a.exact;
      if (preferForSnippet || (h.rank ?? 0) > a.bestRank) {
        a.best = h;
        a.bestRank = h.rank ?? 0;
      }
      if (opts.exact) a.exact = true;
      if (opts.term) a.coverage.add(opts.term);
    }
  };

  // 1. Precision pass — the full query.
  absorb((await run(q, { limit: fetchLimit })).results, { exact: true });

  // 2. Recall pass — OR-combine individual terms (only when multi-word).
  const terms = queryTerms(q);
  if (terms.length > 1) {
    for (const term of terms) {
      absorb((await run(term, { limit: fetchLimit })).results, { term });
    }
  }

  const ranked = [...docs.values()].sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1; // all-terms-in-one-note first
    if (a.coverage.size !== b.coverage.size) return b.coverage.size - a.coverage.size; // more terms covered
    return b.bestRank - a.bestRank; // then by text rank
  });

  return ranked.slice(0, displayCount).map((a) => ({ ...a.best, displayTitle: a.key }));
}
